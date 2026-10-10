from app.db.models.emergency_event import EmergencyEvent

def test_unauthenticated_sync_rejected(client):
    payload = {
        "events": [
            {
                "eventId": "evt-noauth-01",
                "userId": "user-01",
                "deviceId": "dev-01",
                "triggerSource": "VOICE",
                "state": "RESPONDING",
                "createdAt": 1700000000000,
                "updatedAt": 1700000000000
            }
        ]
    }
    res = client.post("/api/v1/emergencies/sync", json=payload)
    assert res.status_code == 403 or res.status_code == 401

def test_idempotent_emergency_sync_10_repeats(client, db_session):
    # Register & Login
    reg_payload = {
        "phone": "+17776665555",
        "password": "Password123!",
        "deviceId": "dev-idempotent-01"
    }
    reg_res = client.post("/api/v1/auth/register", json=reg_payload)
    token = reg_res.json()["accessToken"]
    user_id = reg_res.json()["userId"]
    headers = {"Authorization": f"Bearer {token}"}

    sync_payload = {
        "events": [
            {
                "eventId": "evt-repeat-10-times",
                "userId": user_id,
                "deviceId": "dev-idempotent-01",
                "triggerSource": "VOICE",
                "state": "TRIGGERED",
                "createdAt": 1700000000000,
                "updatedAt": 1700000000000,
                "metadata": {"voiceConfidence": 0.95}
            }
        ]
    }

    # Submit 10 repeated requests
    for i in range(10):
        res = client.post("/api/v1/emergencies/sync", json=sync_payload, headers=headers)
        assert res.status_code == 200
        status_res = res.json()["results"][0]["status"]
        if i == 0:
            assert status_res == "SYNCED"
        else:
            assert status_res == "ALREADY_SYNCED"

    # Verify exactly ONE record exists in database
    records = db_session.query(EmergencyEvent).filter(EmergencyEvent.event_id == "evt-repeat-10-times").all()
    assert len(records) == 1
    assert records[0].trigger_source.value == "VOICE"
    assert records[0].state.value == "TRIGGERED"

def test_batch_sync_and_valid_lifecycle_update(client, db_session):
    reg_payload = {
        "phone": "+17776665556",
        "password": "Password123!",
        "deviceId": "dev-batch-01"
    }
    reg_res = client.post("/api/v1/auth/register", json=reg_payload)
    token = reg_res.json()["accessToken"]
    user_id = reg_res.json()["userId"]
    headers = {"Authorization": f"Bearer {token}"}

    # Initial batch submit
    batch_payload_1 = {
        "events": [
            {
                "eventId": "evt-batch-01",
                "userId": user_id,
                "deviceId": "dev-batch-01",
                "triggerSource": "MANUAL_SOS",
                "state": "TRIGGERED",
                "createdAt": 1700000000000,
                "updatedAt": 1700000000000
            },
            {
                "eventId": "evt-batch-02",
                "userId": user_id,
                "deviceId": "dev-batch-01",
                "triggerSource": "HARDWARE_BUTTON",
                "state": "TRIGGERED",
                "createdAt": 1700000000000,
                "updatedAt": 1700000000000
            }
        ]
    }

    res1 = client.post("/api/v1/emergencies/sync", json=batch_payload_1, headers=headers)
    assert res1.status_code == 200
    assert len(res1.json()["results"]) == 2
    assert res1.json()["results"][0]["status"] == "SYNCED"
    assert res1.json()["results"][1]["status"] == "SYNCED"

    # Newer lifecycle update (RESOLVED) for evt-batch-01
    batch_payload_2 = {
        "events": [
            {
                "eventId": "evt-batch-01",
                "userId": user_id,
                "deviceId": "dev-batch-01",
                "triggerSource": "MANUAL_SOS",
                "state": "RESOLVED",
                "createdAt": 1700000000000,
                "updatedAt": 1700000005000, # 5s later
                "resolvedAt": 1700000005000
            }
        ]
    }

    res2 = client.post("/api/v1/emergencies/sync", json=batch_payload_2, headers=headers)
    assert res2.status_code == 200
    assert res2.json()["results"][0]["status"] == "UPDATED"

    # Verify event state updated in database
    evt1 = db_session.query(EmergencyEvent).filter(EmergencyEvent.event_id == "evt-batch-01").first()
    assert evt1.state.value == "RESOLVED"
    assert evt1.resolved_at == 1700000005000

def test_stale_lifecycle_update_ignored(client, db_session):
    reg_payload = {
        "phone": "+17776665557",
        "password": "Password123!",
        "deviceId": "dev-stale-01"
    }
    reg_res = client.post("/api/v1/auth/register", json=reg_payload)
    token = reg_res.json()["accessToken"]
    user_id = reg_res.json()["userId"]
    headers = {"Authorization": f"Bearer {token}"}

    # Initial submit with newer timestamp
    payload_newer = {
        "events": [
            {
                "eventId": "evt-stale-test",
                "userId": user_id,
                "deviceId": "dev-stale-01",
                "triggerSource": "VOICE",
                "state": "RESOLVED",
                "createdAt": 1700000000000,
                "updatedAt": 1700000010000
            }
        ]
    }
    client.post("/api/v1/emergencies/sync", json=payload_newer, headers=headers)

    # Stale submit with older timestamp attempting to revert state to TRIGGERED
    payload_stale = {
        "events": [
            {
                "eventId": "evt-stale-test",
                "userId": user_id,
                "deviceId": "dev-stale-01",
                "triggerSource": "VOICE",
                "state": "TRIGGERED",
                "createdAt": 1700000000000,
                "updatedAt": 1700000001000 # Older timestamp
            }
        ]
    }
    res_stale = client.post("/api/v1/emergencies/sync", json=payload_stale, headers=headers)
    assert res_stale.status_code == 200
    assert res_stale.json()["results"][0]["status"] == "ALREADY_SYNCED"

    # Confirm DB state remains RESOLVED
    evt = db_session.query(EmergencyEvent).filter(EmergencyEvent.event_id == "evt-stale-test").first()
    assert evt.state.value == "RESOLVED"
