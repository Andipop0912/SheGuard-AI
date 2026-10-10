import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from app.db.models.user import User
from app.db.models.device import Device
from app.db.models.emergency_event import EmergencyEvent, EmergencyStateEnum, EmergencyTriggerSourceEnum

def test_historical_pull_empty(client: TestClient, db_session: Session):
    # Register user to get token
    payload = {
        "phone": "+15551112222",
        "password": "SecurePassword123!",
        "deviceId": "dev-device-01",
        "platform": "android"
    }
    res = client.post("/api/v1/auth/register", json=payload)
    token = res.json()["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}

    response = client.get(f"/api/v1/emergencies/", headers=headers)
    assert response.status_code == 200
    assert response.json() == []

def test_historical_pull_returns_only_user_events(client: TestClient, db_session: Session):
    # Register user A
    res_a = client.post("/api/v1/auth/register", json={
        "phone": "+15551113333",
        "password": "SecurePassword123!",
        "deviceId": "dev-device-a",
        "platform": "android"
    })
    token_a = res_a.json()["accessToken"]
    user_a_id = res_a.json()["userId"]
    headers_a = {"Authorization": f"Bearer {token_a}"}

    # Create event for user A directly in DB
    evt_a = EmergencyEvent(
        event_id="evt-a",
        user_id=user_a_id,
        device_id="dev-device-a",
        trigger_source=EmergencyTriggerSourceEnum.MANUAL_SOS,
        state=EmergencyStateEnum.RESOLVED,
        client_created_at=1000000,
        client_updated_at=1000000,
    )
    db_session.add(evt_a)
    
    # Register user B
    res_b = client.post("/api/v1/auth/register", json={
        "phone": "+15551114444",
        "password": "SecurePassword123!",
        "deviceId": "dev-device-b",
        "platform": "android"
    })
    user_b_id = res_b.json()["userId"]
    
    # Create event for user B directly in DB
    evt_b = EmergencyEvent(
        event_id="evt-b",
        user_id=user_b_id,
        device_id="dev-device-b",
        trigger_source=EmergencyTriggerSourceEnum.VOICE,
        state=EmergencyStateEnum.TRIGGERED,
        client_created_at=1000000,
        client_updated_at=1000000,
    )
    db_session.add(evt_b)
    db_session.commit()

    # User A fetches their history
    response = client.get(f"/api/v1/emergencies/", headers=headers_a)
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["eventId"] == "evt-a"
    assert "evt-b" not in [d["eventId"] for d in data]

def test_historical_pull_unauthenticated(client: TestClient):
    response = client.get(f"/api/v1/emergencies/")
    assert response.status_code == 403
