import time
import pytest
from app.core.config import settings
from app.db.models.emergency_location import EmergencyLocation

EVENT_ID = "evt-location-01"
NOW_MS = int(time.time() * 1000)


def _register(client, phone, device_id):
    res = client.post("/api/v1/auth/register",
                      json={"phone": phone, "password": "Password123!", "deviceId": device_id})
    assert res.status_code == 201
    body = res.json()
    return body["userId"], {"Authorization": f"Bearer {body['accessToken']}"}


def _sync_event(client, headers, user_id, device_id, event_id=EVENT_ID):
    res = client.post("/api/v1/emergencies/sync", headers=headers, json={"events": [{
        "eventId": event_id, "userId": user_id, "deviceId": device_id,
        "triggerSource": "MANUAL_SOS", "state": "RESPONDING",
        "createdAt": NOW_MS, "updatedAt": NOW_MS,
    }]})
    assert res.json()["results"][0]["status"] == "SYNCED"


def _point(location_id, captured_at=NOW_MS, kind="UPDATE", **extra):
    point = {
        "locationId": location_id, "kind": kind,
        "latitude": 19.0760, "longitude": 72.8777, "accuracyMeters": 12.5,
        "provider": "FUSED", "isLastKnown": False, "capturedAt": captured_at,
    }
    point.update(extra)
    return point


def _post(client, headers, points, event_id=EVENT_ID):
    return client.post(f"/api/v1/emergencies/{event_id}/locations/sync",
                       headers=headers, json={"points": points})


@pytest.fixture
def owner(client):
    user_id, headers = _register(client, "+15551110000", "dev-loc-owner")
    _sync_event(client, headers, user_id, "dev-loc-owner")
    return user_id, headers


def test_unauthenticated_location_sync_rejected(client):
    res = client.post(f"/api/v1/emergencies/{EVENT_ID}/locations/sync", json={"points": [_point("loc-x")]})
    assert res.status_code in (401, 403)


def test_owner_syncs_snapshot_and_updates(client, db_session, owner):
    _, headers = owner
    res = _post(client, headers, [
        _point("loc-snap", kind="SNAPSHOT", isLastKnown=True, captured_at=NOW_MS - 60_000),
        _point("loc-upd-1", captured_at=NOW_MS - 15_000, speedMps=1.2, headingDegrees=90.0),
    ])

    assert res.status_code == 200
    body = res.json()
    assert [r["status"] for r in body["results"]] == ["SYNCED", "SYNCED"]
    assert body["storedCount"] == 2

    rows = db_session.query(EmergencyLocation).order_by(EmergencyLocation.captured_at).all()
    assert [r.location_id for r in rows] == ["loc-snap", "loc-upd-1"]
    assert rows[0].is_last_known is True
    assert rows[0].kind.value == "SNAPSHOT"
    assert rows[1].latitude == 19.0760 and rows[1].longitude == 72.8777


def test_resync_is_idempotent(client, db_session, owner):
    _, headers = owner
    for attempt in range(3):
        res = _post(client, headers, [_point("loc-same")])
        expected = "SYNCED" if attempt == 0 else "ALREADY_SYNCED"
        assert res.json()["results"][0]["status"] == expected
    assert db_session.query(EmergencyLocation).count() == 1


def test_duplicate_within_batch_stored_once(client, db_session, owner):
    _, headers = owner
    res = _post(client, headers, [_point("loc-dup"), _point("loc-dup")])
    assert [r["status"] for r in res.json()["results"]] == ["SYNCED", "ALREADY_SYNCED"]
    assert db_session.query(EmergencyLocation).count() == 1


def test_closely_spaced_points_are_all_kept(client, db_session, owner):
    # The server does not thin out legitimate samples; sampling is the client's policy.
    _, headers = owner
    res = _post(client, headers, [_point(f"loc-burst-{i}", captured_at=NOW_MS - 5_000 + i * 1_000) for i in range(5)])
    assert all(r["status"] == "SYNCED" for r in res.json()["results"])
    assert db_session.query(EmergencyLocation).count() == 5


def test_unsynced_emergency_returns_404_so_client_retries(client, owner):
    _, headers = owner
    res = _post(client, headers, [_point("loc-early")], event_id="evt-not-synced-yet")
    assert res.status_code == 404


def test_other_user_cannot_attach_locations_to_known_event(client, db_session, owner):
    _, attacker_headers = _register(client, "+15552220000", "dev-loc-attacker")
    res = _post(client, attacker_headers, [_point("loc-attack")])
    assert res.status_code == 404
    assert db_session.query(EmergencyLocation).count() == 0


def test_owner_other_device_cannot_attach_locations(client, db_session, owner):
    login = client.post("/api/v1/auth/login", json={
        "phone": "+15551110000", "password": "Password123!", "deviceId": "dev-loc-owner-2"})
    headers = {"Authorization": f"Bearer {login.json()['accessToken']}"}
    res = _post(client, headers, [_point("loc-other-device")])
    assert res.status_code == 404
    assert db_session.query(EmergencyLocation).count() == 0


def test_location_id_reused_by_another_user_is_rejected(client, db_session, owner):
    _, headers = owner
    _post(client, headers, [_point("loc-shared-id")])

    other_id, other_headers = _register(client, "+15553330000", "dev-loc-other")
    _sync_event(client, other_headers, other_id, "dev-loc-other", event_id="evt-other-01")
    res = _post(client, other_headers, [_point("loc-shared-id")], event_id="evt-other-01")

    assert res.json()["results"][0]["status"] == "FAILED"
    rows = db_session.query(EmergencyLocation).all()
    assert len(rows) == 1 and rows[0].event_id == EVENT_ID


@pytest.mark.parametrize("bad", [
    {"latitude": 91.0}, {"latitude": -90.5}, {"longitude": 180.5},
    {"accuracyMeters": -1.0}, {"headingDegrees": 360.0}, {"capturedAt": 0},
])
def test_invalid_coordinates_and_fields_rejected(client, db_session, owner, bad):
    _, headers = owner
    res = _post(client, headers, [_point("loc-bad", **bad)])
    assert res.status_code == 422
    assert db_session.query(EmergencyLocation).count() == 0


def test_future_timestamp_rejected_per_item(client, db_session, owner):
    _, headers = owner
    far_future = int(time.time() * 1000) + settings.LOCATION_MAX_FUTURE_SKEW_MS + 60_000
    res = _post(client, headers, [_point("loc-future", captured_at=far_future), _point("loc-ok")])
    assert [r["status"] for r in res.json()["results"]] == ["FAILED", "SYNCED"]


def test_batch_size_limit(client, owner):
    _, headers = owner
    points = [_point(f"loc-batch-{i}") for i in range(settings.LOCATION_SYNC_MAX_BATCH + 1)]
    assert _post(client, headers, points).status_code == 422


def test_per_emergency_point_cap(client, db_session, owner, monkeypatch):
    monkeypatch.setattr(settings, "LOCATION_MAX_POINTS_PER_EMERGENCY", 3)
    _, headers = owner
    res = _post(client, headers, [_point(f"loc-cap-{i}", captured_at=NOW_MS - 10_000 + i) for i in range(5)])
    assert [r["status"] for r in res.json()["results"]] == ["SYNCED", "SYNCED", "SYNCED", "FAILED", "FAILED"]
    assert db_session.query(EmergencyLocation).count() == 3


def test_latest_location_for_owner(client, owner):
    _, headers = owner
    _post(client, headers, [
        _point("loc-old", captured_at=NOW_MS - 30_000),
        _point("loc-new", captured_at=NOW_MS - 1_000, latitude=19.1),
    ])
    res = client.get(f"/api/v1/emergencies/{EVENT_ID}/locations/latest", headers=headers)
    assert res.status_code == 200
    assert res.json()["locationId"] == "loc-new"
    assert res.json()["latitude"] == 19.1


def test_latest_location_hidden_from_other_users(client, owner):
    _, headers = owner
    _post(client, headers, [_point("loc-private")])
    _, other_headers = _register(client, "+15554440000", "dev-loc-snoop")
    res = client.get(f"/api/v1/emergencies/{EVENT_ID}/locations/latest", headers=other_headers)
    assert res.status_code == 404


def test_latest_location_404_when_none_recorded(client, owner):
    _, headers = owner
    res = client.get(f"/api/v1/emergencies/{EVENT_ID}/locations/latest", headers=headers)
    assert res.status_code == 404
