from fastapi import status

# Phase 3D (D10): communication records are created ONLY by the server's dispatch engine.

def register_and_login(client, phone, device_id):
    reg_resp = client.post(
        "/api/v1/auth/register",
        json={"phone": phone, "password": "Password123!", "deviceId": device_id}
    )
    assert reg_resp.status_code == status.HTTP_201_CREATED, reg_resp.json()
    data = reg_resp.json()
    return {"Authorization": f"Bearer {data['accessToken']}"}, data["userId"]

def sync_event(client, headers, user_id, event_id, device_id, state="TRIGGERED"):
    payload = {
        "events": [
            {
                "eventId": event_id,
                "userId": user_id,
                "deviceId": device_id,
                "triggerSource": "MANUAL_SOS",
                "state": state,
                "createdAt": 1728000000000,
                "updatedAt": 1728000000000,
                "resolvedAt": None,
                "metadata": {}
            }
        ]
    }
    sync_resp = client.post("/api/v1/emergencies/sync", json=payload, headers=headers)
    assert sync_resp.status_code == status.HTTP_200_OK, sync_resp.json()


def test_client_cannot_create_communication_records(client):
    headers, user_id = register_and_login(client, "+919100000001", "dev_logs_1")
    contact = client.post("/api/v1/contacts", json={"name": "Mom", "phone": "9100000002"}, headers=headers).json()
    sync_event(client, headers, user_id, "evt_logs_no_create", "dev_logs_1")

    resp = client.post(
        "/api/v1/emergency/communication/logs",
        json={"event_id": "evt_logs_no_create", "contact_id": contact["id"], "channel": "SMS"},
        headers=headers,
    )
    assert resp.status_code in (status.HTTP_404_NOT_FOUND, status.HTTP_405_METHOD_NOT_ALLOWED)


def test_server_created_records_are_listed_with_contact_snapshot(client):
    headers, user_id = register_and_login(client, "+919100000003", "dev_logs_2")
    client.post("/api/v1/contacts", json={"name": "Sister", "phone": "+919100000004", "relationship": "Sister"}, headers=headers)
    sync_event(client, headers, user_id, "evt_logs_listed", "dev_logs_2")  # auto-dispatch (simulated SMS)

    resp = client.get("/api/v1/emergency/communication/logs/evt_logs_listed", headers=headers)
    assert resp.status_code == status.HTTP_200_OK
    logs = resp.json()
    assert len(logs) == 1
    log = logs[0]
    assert log["contact_name"] == "Sister"
    assert log["contact_phone"] == "+919100000004"
    assert log["contact_deleted"] is False
    assert log["channel"] == "SMS"
    assert log["status"] == "PROVIDER_ACCEPTED"
    assert log["is_simulated"] is True
    assert log["attempt_count"] == 1


def test_other_user_cannot_read_records(client):
    headers_a, user_a = register_and_login(client, "+919100000005", "dev_logs_a")
    headers_b, _ = register_and_login(client, "+919100000006", "dev_logs_b")
    client.post("/api/v1/contacts", json={"name": "A's Mom", "phone": "+919100000007"}, headers=headers_a)
    sync_event(client, headers_a, user_a, "evt_logs_private", "dev_logs_a")

    resp = client.get("/api/v1/emergency/communication/logs/evt_logs_private", headers=headers_b)
    assert resp.status_code in (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND)


def test_unauthenticated_read_rejected(client):
    resp = client.get("/api/v1/emergency/communication/logs/anything")
    assert resp.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)
