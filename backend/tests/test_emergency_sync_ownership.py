"""
Regression tests: an existing emergency may only be updated by the user who owns it,
from the device that created it — even when an attacker knows the event_id.
"""
from app.db.models.emergency_event import EmergencyEvent

EVENT_ID = "evt-ownership-victim-01"


def _register(client, phone: str, device_id: str):
    res = client.post(
        "/api/v1/auth/register",
        json={"phone": phone, "password": "Password123!", "deviceId": device_id},
    )
    assert res.status_code == 201
    body = res.json()
    return body["userId"], {"Authorization": f"Bearer {body['accessToken']}"}


def _login(client, phone: str, device_id: str):
    res = client.post(
        "/api/v1/auth/login",
        json={"phone": phone, "password": "Password123!", "deviceId": device_id},
    )
    assert res.status_code == 200
    body = res.json()
    return body["userId"], {"Authorization": f"Bearer {body['accessToken']}"}


def _event(user_id: str, device_id: str, state: str, updated_at: int, resolved_at=None):
    return {
        "eventId": EVENT_ID,
        "userId": user_id,
        "deviceId": device_id,
        "triggerSource": "MANUAL_SOS",
        "state": state,
        "createdAt": 1700000000000,
        "updatedAt": updated_at,
        "resolvedAt": resolved_at,
        "metadata": {"owner": "victim"},
    }


def _create_victim_event(client):
    victim_id, victim_headers = _register(client, "+15550001111", "dev-victim")
    res = client.post(
        "/api/v1/emergencies/sync",
        json={"events": [_event(victim_id, "dev-victim", "RESPONDING", 1700000000000)]},
        headers=victim_headers,
    )
    assert res.json()["results"][0]["status"] == "SYNCED"
    return victim_id, victim_headers


def test_other_user_cannot_update_known_event_id(client, db_session):
    _create_victim_event(client)
    attacker_id, attacker_headers = _register(client, "+15550002222", "dev-attacker")

    # Attacker submits a NEWER update for the victim's event, using their own (valid) identity.
    res = client.post(
        "/api/v1/emergencies/sync",
        json={
            "events": [
                _event(attacker_id, "dev-attacker", "CANCELLED", 1700000099999, resolved_at=1700000099999)
            ]
        },
        headers=attacker_headers,
    )

    assert res.status_code == 200
    result = res.json()["results"][0]
    assert result["status"] == "FAILED"
    # Must not reveal whether the event exists for someone else.
    assert "not found" in (result["message"] or "").lower()

    db_session.expire_all()
    stored = db_session.query(EmergencyEvent).filter(EmergencyEvent.event_id == EVENT_ID).one()
    assert stored.state.value == "RESPONDING"
    assert stored.client_updated_at == 1700000000000
    assert stored.resolved_at is None
    assert stored.metadata_json == {"owner": "victim"}


def test_owner_from_another_device_cannot_update_event(client, db_session):
    victim_id, _ = _create_victim_event(client)
    # Same account, signed in on a second device.
    second_id, second_headers = _login(client, "+15550001111", "dev-victim-second")
    assert second_id == victim_id

    res = client.post(
        "/api/v1/emergencies/sync",
        json={"events": [_event(victim_id, "dev-victim-second", "RESOLVED", 1700000099999, 1700000099999)]},
        headers=second_headers,
    )

    assert res.json()["results"][0]["status"] == "FAILED"
    db_session.expire_all()
    stored = db_session.query(EmergencyEvent).filter(EmergencyEvent.event_id == EVENT_ID).one()
    assert stored.state.value == "RESPONDING"


def test_owner_device_can_still_update_its_event(client, db_session):
    victim_id, victim_headers = _create_victim_event(client)

    res = client.post(
        "/api/v1/emergencies/sync",
        json={"events": [_event(victim_id, "dev-victim", "RESOLVED", 1700000099999, 1700000099999)]},
        headers=victim_headers,
    )

    assert res.json()["results"][0]["status"] == "UPDATED"
    db_session.expire_all()
    stored = db_session.query(EmergencyEvent).filter(EmergencyEvent.event_id == EVENT_ID).one()
    assert stored.state.value == "RESOLVED"
