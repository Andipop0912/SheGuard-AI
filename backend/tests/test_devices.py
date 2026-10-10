def test_device_binding_and_mismatch_rejection(client):
    # Register user with device A
    reg_payload = {
        "phone": "+19998887777",
        "password": "Password123!",
        "deviceId": "device-authorized-01"
    }
    reg_res = client.post("/api/v1/auth/register", json=reg_payload)
    token = reg_res.json()["accessToken"]

    # Authorized request with device A token to emergency sync endpoint
    sync_payload = {
        "events": [
            {
                "eventId": "evt-bound-01",
                "userId": reg_res.json()["userId"],
                "deviceId": "device-authorized-01",
                "triggerSource": "VOICE",
                "state": "RESPONDING",
                "createdAt": 1700000000000,
                "updatedAt": 1700000000000
            }
        ]
    }
    headers = {"Authorization": f"Bearer {token}"}
    sync_res = client.post("/api/v1/emergencies/sync", json=sync_payload, headers=headers)
    assert sync_res.status_code == 200
    assert sync_res.json()["results"][0]["status"] == "SYNCED"

    # Mismatched device ID in payload rejected by emergency service check
    mismatched_payload = {
        "events": [
            {
                "eventId": "evt-mismatch-01",
                "userId": reg_res.json()["userId"],
                "deviceId": "device-UNAUTHORIZED-99",
                "triggerSource": "VOICE",
                "state": "RESPONDING",
                "createdAt": 1700000000000,
                "updatedAt": 1700000000000
            }
        ]
    }
    mismatch_res = client.post("/api/v1/emergencies/sync", json=mismatched_payload, headers=headers)
    assert mismatch_res.status_code == 200
    assert mismatch_res.json()["results"][0]["status"] == "FAILED"
    assert "mismatch" in mismatch_res.json()["results"][0]["message"]
