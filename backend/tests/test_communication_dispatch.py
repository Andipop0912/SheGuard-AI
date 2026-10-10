import pytest
import uuid
from datetime import datetime, timezone
from fastapi import status
from app.db.models.communication_log import (
    EmergencyCommunicationLog,
    CommunicationChannelEnum,
    CommunicationStatusEnum,
)
from app.db.models.emergency_event import EmergencyEvent
from app.services.communication_provider import (
    MockBaseProvider,
    MockSmsProvider,
    MockFcmProvider,
    MockVoiceCallProvider,
    ProviderRegistry,
    ProviderResponse,
)
from app.services.communication_service import dispatch_emergency_communications
from app.schemas.communication import DispatchEmergencyRequest

def register_and_login(client, phone, device_id="dev_dispatch_01"):
    reg_resp = client.post(
        "/api/v1/auth/register",
        json={"phone": phone, "password": "Password123!", "deviceId": device_id}
    )
    assert reg_resp.status_code == status.HTTP_201_CREATED, reg_resp.json()
    data = reg_resp.json()
    return {"Authorization": f"Bearer {data['accessToken']}"}, data["userId"]

def create_emergency_event(client, headers, user_id, event_id, device_id="dev_dispatch_01"):
    payload = {
        "events": [
            {
                "eventId": event_id,
                "userId": str(user_id) if user_id else "00000000-0000-0000-0000-000000000000",
                "deviceId": device_id,
                "triggerSource": "MANUAL_SOS",
                "state": "TRIGGERED",
                "createdAt": 1728000000000,
                "updatedAt": 1728000000000,
                "resolvedAt": None,
                "metadata": {}
            }
        ]
    }
    sync_resp = client.post("/api/v1/emergencies/sync", json=payload, headers=headers)
    assert sync_resp.status_code == status.HTTP_200_OK

# 1. No Contacts
@pytest.mark.asyncio
async def test_dispatch_no_contacts(client):
    headers, user_id = register_and_login(client, "+919200000001")
    event_id = "evt_no_contacts"
    create_emergency_event(client, headers, user_id, event_id)

    resp = client.post(f"/api/v1/emergencies/{event_id}/dispatch", headers=headers)
    assert resp.status_code == status.HTTP_200_OK
    data = resp.json()
    assert data["total_contacts"] == 0
    assert data["total_attempts"] == 0
    assert len(data["attempts"]) == 0

# 2. One Contact & 6. SMS Mock Success
@pytest.mark.asyncio
async def test_dispatch_one_contact_sms_success(client):
    headers, user_id = register_and_login(client, "+919200000002")
    event_id = "evt_one_contact"
    create_emergency_event(client, headers, user_id, event_id)

    client.post("/api/v1/contacts", json={"name": "Guardian 1", "phone": "+919200000003"}, headers=headers)

    resp = client.post(f"/api/v1/emergencies/{event_id}/dispatch", headers=headers)
    assert resp.status_code == status.HTTP_200_OK
    data = resp.json()
    assert data["total_contacts"] == 1
    assert data["total_attempts"] == 1
    assert data["successful_attempts"] == 1
    assert data["attempts"][0]["channel"] == "SMS"
    assert data["attempts"][0]["status"] == "PROVIDER_ACCEPTED"
    assert data["attempts"][0]["provider_message_id"].startswith("mock_sms_acc_")

# 3. Multiple Contacts & 4. Priority Ordering
@pytest.mark.asyncio
async def test_dispatch_multiple_contacts_priority_ordering(client):
    headers, user_id = register_and_login(client, "+919200000004")
    event_id = "evt_multi_priority"
    create_emergency_event(client, headers, user_id, event_id)

    # Priority 3 (Friend)
    client.post("/api/v1/contacts", json={"name": "Friend", "phone": "+919200000005", "priority": 3}, headers=headers)
    # Priority 1 (Mother)
    client.post("/api/v1/contacts", json={"name": "Mother", "phone": "+919200000006", "priority": 1}, headers=headers)
    # Priority 2 (Father)
    client.post("/api/v1/contacts", json={"name": "Father", "phone": "+919200000007", "priority": 2}, headers=headers)

    resp = client.post(f"/api/v1/emergencies/{event_id}/dispatch", headers=headers)
    assert resp.status_code == status.HTTP_200_OK
    data = resp.json()
    assert data["total_contacts"] == 3
    assert data["total_attempts"] == 3
    
    # Verify strict priority ordering (Mother -> Father -> Friend)
    attempts = data["attempts"]
    assert attempts[0]["contact_name"] == "Mother"
    assert attempts[1]["contact_name"] == "Father"
    assert attempts[2]["contact_name"] == "Friend"

# 5. Inactive Contact Ignored
@pytest.mark.asyncio
async def test_dispatch_inactive_contact_ignored(client):
    headers, user_id = register_and_login(client, "+919200000008")
    event_id = "evt_inactive_test"
    create_emergency_event(client, headers, user_id, event_id)

    client.post("/api/v1/contacts", json={"name": "Active Contact", "phone": "+919200000009", "is_active": True}, headers=headers)
    client.post("/api/v1/contacts", json={"name": "Inactive Contact", "phone": "+919200000010", "is_active": False}, headers=headers)

    resp = client.post(f"/api/v1/emergencies/{event_id}/dispatch", headers=headers)
    assert resp.status_code == status.HTTP_200_OK
    data = resp.json()
    assert data["total_contacts"] == 1
    assert data["attempts"][0]["contact_name"] == "Active Contact"

# 7. FCM Mock Success & 8. Voice Call Mock Success
@pytest.mark.asyncio
async def test_dispatch_multi_channel_fcm_voice_success(client, db_session):
    # Phase 3D: only SMS has a provider. FCM / VOICE_CALL must NEVER be reported as accepted;
    # they are recorded NOT_SENT (channel_not_available). (Previously this test asserted fake success.)
    headers, user_id = register_and_login(client, "+919200000011")
    user_uuid = uuid.UUID(user_id)
    event_id = "evt_multi_channel"
    create_emergency_event(client, headers, user_id, event_id)

    client.post("/api/v1/contacts", json={"name": "Contact Multi", "phone": "+919200000012"}, headers=headers)

    req = DispatchEmergencyRequest(channels=[
        CommunicationChannelEnum.SMS, CommunicationChannelEnum.FCM, CommunicationChannelEnum.VOICE_CALL
    ])
    summary = await dispatch_emergency_communications(db_session, user_uuid, event_id, req)
    by_channel = {a.channel: a for a in summary.attempts}
    assert by_channel[CommunicationChannelEnum.SMS].status == CommunicationStatusEnum.PROVIDER_ACCEPTED
    assert by_channel[CommunicationChannelEnum.SMS].is_simulated is True
    for channel in (CommunicationChannelEnum.FCM, CommunicationChannelEnum.VOICE_CALL):
        assert by_channel[channel].status == CommunicationStatusEnum.NOT_SENT
        assert by_channel[channel].reason_code == "channel_not_available"
        assert by_channel[channel].attempt_count == 0

# 9. Provider Rejection & 10. Transient Failure & 11. Retry & 12. Retry Limit
@pytest.mark.asyncio
async def test_provider_rejection_and_bounded_retry(client, db_session):
    headers, user_id_str = register_and_login(client, "+919200000013")
    user_uuid = uuid.UUID(user_id_str)
    event_id = "evt_retry_test"
    create_emergency_event(client, headers, user_uuid, event_id)

    contact_resp = client.post("/api/v1/contacts", json={"name": "Retry Contact", "phone": "+919200000014"}, headers=headers)
    contact_id = uuid.UUID(contact_resp.json()["id"])

    # Configure mock provider that fails
    failing_sms_provider = MockSmsProvider(should_fail=True, failure_reason="Gateway timeout", is_retryable=True)
    registry = ProviderRegistry(overrides={CommunicationChannelEnum.SMS: failing_sms_provider})

    req = DispatchEmergencyRequest(channels=[CommunicationChannelEnum.SMS])
    summary = await dispatch_emergency_communications(db_session, user_uuid, event_id, req, provider_registry=registry)
    
    assert summary.total_attempts == 1
    assert summary.failed_attempts == 1
    assert summary.attempts[0].status == CommunicationStatusEnum.FAILED
    assert summary.attempts[0].failure_reason == "Gateway timeout"
    # Verify retry loop ran 3 times (1 initial + 2 retries = 3 calls)
    assert failing_sms_provider.call_count == 3

# 13. Failure Isolation
@pytest.mark.asyncio
async def test_failure_isolation_one_contact_fails_others_succeed(client, db_session):
    headers, user_id_str = register_and_login(client, "+919200000015")
    user_uuid = uuid.UUID(user_id_str)
    event_id = "evt_isolation_test"
    create_emergency_event(client, headers, user_uuid, event_id)

    # Contact 1 (Mother)
    c1 = client.post("/api/v1/contacts", json={"name": "Mother", "phone": "+919200000016", "priority": 1}, headers=headers).json()
    # Contact 2 (Father)
    c2 = client.post("/api/v1/contacts", json={"name": "Father", "phone": "+919200000017", "priority": 2}, headers=headers).json()

    # Custom provider that fails on Mother (+919200000016) but succeeds on Father (+919200000017)
    class SelectiveFailProvider(MockSmsProvider):
        async def send_dispatch(self, log, contact, message):
            now = datetime.now(timezone.utc)
            if contact.phone == "+919200000016":
                return ProviderResponse(
                    success=False,
                    status=CommunicationStatusEnum.FAILED,
                    failed_at=now,
                    failure_reason="Contact 1 network down",
                    is_retryable=False,
                )
            return ProviderResponse(
                success=True,
                status=CommunicationStatusEnum.PROVIDER_ACCEPTED,
                provider_message_id="mock_selective_ok",
                accepted_at=now,
            )

    selective_provider = SelectiveFailProvider()
    registry = ProviderRegistry(overrides={CommunicationChannelEnum.SMS: selective_provider})

    req = DispatchEmergencyRequest(channels=[CommunicationChannelEnum.SMS])
    summary = await dispatch_emergency_communications(db_session, user_uuid, event_id, req, provider_registry=registry)

    assert summary.total_contacts == 2
    assert summary.total_attempts == 2
    assert summary.successful_attempts == 1
    assert summary.failed_attempts == 1
    assert summary.attempts[0].status == CommunicationStatusEnum.FAILED
    assert summary.attempts[1].status == CommunicationStatusEnum.PROVIDER_ACCEPTED

# 14. Communication State Transitions & 15. Delivery Confirmation & 16. Provider Accepted Truthful Delivery
@pytest.mark.asyncio
async def test_truthful_delivery_semantics(client, db_session):
    headers, user_id_str = register_and_login(client, "+919200000018")
    user_uuid = uuid.UUID(user_id_str)
    event_id = "evt_truthful_deliv"
    create_emergency_event(client, headers, user_uuid, event_id)

    client.post("/api/v1/contacts", json={"name": "Truthful Contact", "phone": "+919200000019"}, headers=headers)

    # 1. Provider returns PROVIDER_ACCEPTED without delivery receipt confirmation
    acc_provider = MockSmsProvider(should_fail=False, confirm_delivery=False)
    registry_acc = ProviderRegistry(overrides={CommunicationChannelEnum.SMS: acc_provider})
    summary_acc = await dispatch_emergency_communications(db_session, user_uuid, event_id, DispatchEmergencyRequest(), provider_registry=registry_acc)
    assert summary_acc.attempts[0].status == CommunicationStatusEnum.PROVIDER_ACCEPTED
    assert summary_acc.attempts[0].status != CommunicationStatusEnum.DELIVERED # Must NOT falsely claim DELIVERED

    # 2. Provider returns DELIVERED with explicit delivery confirmation receipt.
    # A separate user whose contact is added AFTER the sync: since Phase 3D the sync itself
    # dispatches automatically, and an already accepted alert is never re-sent.
    headers_2, user_id_2 = register_and_login(client, "+919200000030", "dev_dispatch_02")
    user_uuid_2 = uuid.UUID(user_id_2)
    event_id_2 = "evt_truthful_deliv_2"
    create_emergency_event(client, headers_2, user_uuid_2, event_id_2, "dev_dispatch_02")
    client.post("/api/v1/contacts", json={"name": "Truthful Contact 2", "phone": "+919200000031"}, headers=headers_2)
    deliv_provider = MockSmsProvider(should_fail=False, confirm_delivery=True)
    registry_deliv = ProviderRegistry(overrides={CommunicationChannelEnum.SMS: deliv_provider})
    summary_deliv = await dispatch_emergency_communications(db_session, user_uuid_2, event_id_2, DispatchEmergencyRequest(), provider_registry=registry_deliv)
    assert summary_deliv.attempts[0].status == CommunicationStatusEnum.DELIVERED

# 17. Duplicate Dispatch Idempotency & 18. Duplicate Event Dispatch
@pytest.mark.asyncio
async def test_idempotent_duplicate_dispatch(client):
    headers, user_id = register_and_login(client, "+919200000020")
    event_id = "evt_idempotent_dispatch"
    create_emergency_event(client, headers, user_id, event_id)

    client.post("/api/v1/contacts", json={"name": "Idempotent Contact", "phone": "+919200000021"}, headers=headers)

    # First dispatch
    resp1 = client.post(f"/api/v1/emergencies/{event_id}/dispatch", headers=headers)
    assert resp1.status_code == status.HTTP_200_OK
    log_id_1 = resp1.json()["attempts"][0]["id"]

    # Second repeated dispatch call on SAME event
    resp2 = client.post(f"/api/v1/emergencies/{event_id}/dispatch", headers=headers)
    assert resp2.status_code == status.HTTP_200_OK
    log_id_2 = resp2.json()["attempts"][0]["id"]

    # Must reuse existing attempt log without creating duplicate row
    assert log_id_1 == log_id_2
    assert resp2.json()["total_attempts"] == 1

# 19. Cross-User Dispatch Rejected
@pytest.mark.asyncio
async def test_cross_user_dispatch_rejected(client):
    headers_a, user_a_id = register_and_login(client, "+919200000022", "dev_user_a")
    headers_b, user_b_id = register_and_login(client, "+919200000023", "dev_user_b")

    event_id_a = "evt_owned_by_user_a"
    create_emergency_event(client, headers_a, user_a_id, event_id_a, "dev_user_a")

    # User B attempts to trigger dispatch on User A's emergency event
    resp = client.post(f"/api/v1/emergencies/{event_id_a}/dispatch", headers=headers_b)
    assert resp.status_code in [status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND]

# 21. Provider Exception Handling
@pytest.mark.asyncio
async def test_provider_uncaught_exception_handled_gracefully(client, db_session):
    headers, user_id_str = register_and_login(client, "+919200000024")
    user_uuid = uuid.UUID(user_id_str)
    event_id = "evt_provider_crash"
    create_emergency_event(client, headers, user_uuid, event_id)

    client.post("/api/v1/contacts", json={"name": "Crash Contact", "phone": "+919200000025"}, headers=headers)

    class CrashingProvider(MockSmsProvider):
        async def send_dispatch(self, log, contact, message):
            raise RuntimeError("Unexpected Gateway Crash")

    registry = ProviderRegistry(overrides={CommunicationChannelEnum.SMS: CrashingProvider()})
    summary = await dispatch_emergency_communications(db_session, user_uuid, event_id, DispatchEmergencyRequest(), provider_registry=registry)
    
    assert summary.total_attempts == 1
    assert summary.failed_attempts == 1
    assert summary.attempts[0].status == CommunicationStatusEnum.FAILED
    assert "Provider exception: Unexpected Gateway Crash" in summary.attempts[0].failure_reason

# 24. CRITICAL SAFETY TEST: Emergency State Unaffected by Communication Failure
@pytest.mark.asyncio
async def test_safety_emergency_state_unaffected_by_communication_failure(client, db_session):
    headers, user_id_str = register_and_login(client, "+919200000026")
    user_uuid = uuid.UUID(user_id_str)
    event_id = "evt_safety_test"
    create_emergency_event(client, headers, user_uuid, event_id)

    client.post("/api/v1/contacts", json={"name": "Safety Contact", "phone": "+919200000027"}, headers=headers)

    # Force complete communication failure
    failing_sms_provider = MockSmsProvider(should_fail=True, failure_reason="Complete SMS blackout")
    registry = ProviderRegistry(overrides={CommunicationChannelEnum.SMS: failing_sms_provider})

    summary = await dispatch_emergency_communications(db_session, user_uuid, event_id, DispatchEmergencyRequest(), provider_registry=registry)
    assert summary.failed_attempts == 1

    # CRITICAL CHECK: EmergencyEvent in database must REMAIN TRIGGERED and MUST NOT change or cancel
    event = db_session.query(EmergencyEvent).filter(EmergencyEvent.event_id == event_id).first()
    assert event is not None
    assert event.state.value == "TRIGGERED"
    assert event.state.value != "CANCELLED"
    assert event.state.value != "RESOLVED"
