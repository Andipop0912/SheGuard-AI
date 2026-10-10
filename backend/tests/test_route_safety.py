from fastapi import status
from app.db.models.route_safety import RouteSafetyCommunicationLog


def register_and_login(client, phone, device_id="dev_rs_01"):
    reg_resp = client.post(
        "/api/v1/auth/register",
        json={"phone": phone, "password": "Password123!", "deviceId": device_id},
    )
    assert reg_resp.status_code == status.HTTP_201_CREATED, reg_resp.json()
    data = reg_resp.json()
    return {"Authorization": f"Bearer {data['accessToken']}"}, data["userId"]


def create_contact(client, headers, name="Bhoomi", phone="+919326754208"):
    resp = client.post("/api/v1/contacts", json={"name": name, "phone": phone, "priority": 1}, headers=headers)
    assert resp.status_code == status.HTTP_201_CREATED, resp.json()
    return resp.json()


def start_session(client, headers, session_id="rs-test-1", device_id="dev_rs_01"):
    payload = {
        "sessionId": session_id,
        "deviceId": device_id,
        "startLocation": {"latitude": 19.0760, "longitude": 72.8777},
        "destinationText": "Office",
        "destinationLocation": {"latitude": 19.0825, "longitude": 72.8811},
        "routePolyline": [
            {"latitude": 19.0760, "longitude": 72.8777},
            {"latitude": 19.0825, "longitude": 72.8811},
        ],
        "routeDistanceMeters": 1000.0,
        "routeDurationSeconds": 900,
        "startedAt": 1_728_000_000_000,
    }
    return client.post("/api/v1/route-safety", json=payload, headers=headers)


def test_create_session_and_immediate_start_notification(client, db_session):
    headers, _ = register_and_login(client, "+919000000001")
    create_contact(client, headers)

    resp = start_session(client, headers)
    assert resp.status_code == status.HTTP_201_CREATED, resp.json()
    data = resp.json()
    assert data["status"] == "ACTIVE"
    assert data["deviationState"] == "ON_ROUTE"
    assert data["destinationText"] == "Office"

    logs = db_session.query(RouteSafetyCommunicationLog).filter(
        RouteSafetyCommunicationLog.session_id == "rs-test-1", RouteSafetyCommunicationLog.kind == "STARTED"
    ).all()
    assert len(logs) == 1
    assert logs[0].status in ("PROVIDER_ACCEPTED", "DELIVERED")
    assert logs[0].is_simulated is True


def test_cannot_start_a_second_session_while_one_is_active(client):
    headers, _ = register_and_login(client, "+919000000002")
    start_session(client, headers, session_id="rs-test-a")
    resp = start_session(client, headers, session_id="rs-test-b")
    assert resp.status_code == status.HTTP_409_CONFLICT


def test_another_user_cannot_see_or_modify_someone_elses_session(client):
    headers_a, _ = register_and_login(client, "+919000000003")
    start_session(client, headers_a, session_id="rs-test-owner")

    headers_b, _ = register_and_login(client, "+919000000004")
    resp = client.post("/api/v1/route-safety/rs-test-owner/location", json={"latitude": 1, "longitude": 1, "timestamp": 1}, headers=headers_b)
    assert resp.status_code == status.HTTP_404_NOT_FOUND

    resp_end = client.post("/api/v1/route-safety/rs-test-owner/end", headers=headers_b)
    assert resp_end.status_code == status.HTTP_404_NOT_FOUND


def test_sync_location_updates_current_position_and_rejects_stale_out_of_order_updates(client):
    headers, _ = register_and_login(client, "+919000000005")
    start_session(client, headers, session_id="rs-test-loc")

    resp = client.post(
        "/api/v1/route-safety/rs-test-loc/location",
        json={"latitude": 19.08, "longitude": 72.88, "timestamp": 1_728_000_010_000},
        headers=headers,
    )
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["currentLocation"] == {"latitude": 19.08, "longitude": 72.88}

    # An older (stale) point must not overwrite the newer one.
    stale = client.post(
        "/api/v1/route-safety/rs-test-loc/location",
        json={"latitude": 1.0, "longitude": 1.0, "timestamp": 1_728_000_005_000},
        headers=headers,
    )
    assert stale.json()["currentLocation"] == {"latitude": 19.08, "longitude": 72.88}


def test_deviation_alert_is_sent_once_per_session_even_if_recorded_twice(client, db_session):
    headers, _ = register_and_login(client, "+919000000006")
    create_contact(client, headers)
    start_session(client, headers, session_id="rs-test-dev")

    r1 = client.post("/api/v1/route-safety/rs-test-dev/deviation", headers=headers)
    assert r1.status_code == status.HTTP_202_ACCEPTED
    r2 = client.post("/api/v1/route-safety/rs-test-dev/deviation", headers=headers)
    assert r2.status_code == status.HTTP_202_ACCEPTED

    logs = db_session.query(RouteSafetyCommunicationLog).filter(
        RouteSafetyCommunicationLog.session_id == "rs-test-dev", RouteSafetyCommunicationLog.kind == "DEVIATION"
    ).all()
    assert len(logs) == 1  # the unique constraint prevented a second send


def test_ending_session_allows_starting_a_new_one(client):
    headers, _ = register_and_login(client, "+919000000007")
    start_session(client, headers, session_id="rs-test-end-1")

    end_resp = client.post("/api/v1/route-safety/rs-test-end-1/end", headers=headers)
    assert end_resp.status_code == status.HTTP_200_OK
    assert end_resp.json()["status"] == "ENDED"

    resp = start_session(client, headers, session_id="rs-test-end-2")
    assert resp.status_code == status.HTTP_201_CREATED


def test_get_active_session_returns_null_when_none_and_the_session_once_started(client):
    headers, _ = register_and_login(client, "+919000000008")
    resp_none = client.get("/api/v1/route-safety/active", headers=headers)
    assert resp_none.status_code == status.HTTP_200_OK
    assert resp_none.json() is None

    start_session(client, headers, session_id="rs-test-active")
    resp_active = client.get("/api/v1/route-safety/active", headers=headers)
    assert resp_active.json()["sessionId"] == "rs-test-active"


def test_live_location_link_is_unauthenticated_but_scoped_to_the_share_token(client):
    headers, _ = register_and_login(client, "+919000000009")
    create_resp = start_session(client, headers, session_id="rs-test-live")
    # The share token is never exposed on the authenticated session DTO itself.
    assert "shareToken" not in create_resp.json() and "share_token" not in create_resp.json()

    # An unguessable/garbage token must not resolve to anyone's session.
    resp = client.get("/api/v1/route-safety/live/not-a-real-token")
    assert resp.status_code == status.HTTP_404_NOT_FOUND
