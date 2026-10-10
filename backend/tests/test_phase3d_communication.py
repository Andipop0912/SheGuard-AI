"""Phase 3D: trusted contacts + server-owned emergency communication (decisions D1–D11)."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import status

from app.core.config import settings
from app.core.dependencies import get_provider_registry_factory
from app.db.models.communication_log import (
    CommunicationChannelEnum,
    CommunicationStatusEnum,
    EmergencyCommunicationLog,
)
from app.db.models.emergency_event import EmergencyEvent, EmergencyStateEnum
from app.main import app
from app.services.communication_provider import MockSmsProvider, ProviderRegistry, ProviderResponse
from app.services.communication_service import dispatch_emergency_communications

CREATED_MS = 1728000000000  # 2024-10-04 00:00:00 UTC = 05:30 IST


# ---------------------------------------------------------------- helpers

def register(client, phone, device_id):
    resp = client.post("/api/v1/auth/register", json={"phone": phone, "password": "Password123!", "deviceId": device_id})
    assert resp.status_code == status.HTTP_201_CREATED, resp.json()
    data = resp.json()
    return {"Authorization": f"Bearer {data['accessToken']}"}, data["userId"]


def sync(client, headers, user_id, device_id, event_id, state="RESPONDING", updated=CREATED_MS, trigger="VOICE"):
    body = {"events": [{
        "eventId": event_id, "userId": user_id, "deviceId": device_id, "triggerSource": trigger,
        "state": state, "createdAt": CREATED_MS, "updatedAt": updated,
        "resolvedAt": updated if state in ("RESOLVED", "CANCELLED") else None, "metadata": {},
    }]}
    resp = client.post("/api/v1/emergencies/sync", json=body, headers=headers)
    assert resp.status_code == status.HTTP_200_OK, resp.json()
    return resp.json()["results"][0]["status"]


def add_contact(client, headers, name, phone, priority=1, active=True):
    return client.post(
        "/api/v1/contacts",
        json={"name": name, "phone": phone, "priority": priority, "is_active": active},
        headers=headers,
    )


def logs(client, headers, event_id):
    resp = client.get(f"/api/v1/emergency/communication/logs/{event_id}", headers=headers)
    assert resp.status_code == status.HTTP_200_OK, resp.json()
    return resp.json()


class CapturingSmsProvider(MockSmsProvider):
    """Simulated SMS provider that records the messages it was asked to send."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.sent = []

    async def send_dispatch(self, log, contact, message):
        self.sent.append((contact.phone, message))
        return await super().send_dispatch(log, contact, message)


@pytest.fixture
def capture(client):
    provider = CapturingSmsProvider()
    app.dependency_overrides[get_provider_registry_factory] = lambda: (
        lambda: ProviderRegistry(overrides={CommunicationChannelEnum.SMS: provider})
    )
    yield provider
    app.dependency_overrides.pop(get_provider_registry_factory, None)


# ---------------------------------------------------------------- D1 server-triggered dispatch

def test_d1_first_sync_of_open_emergency_alerts_active_contacts_in_priority_order(client, capture):
    headers, user = register(client, "+919300000001", "dev3d_1")
    add_contact(client, headers, "Sister", "9300000003", priority=2)
    add_contact(client, headers, "Mom", "9300000002", priority=1)
    add_contact(client, headers, "Friend", "9300000004", priority=1, active=False)
    brother = add_contact(client, headers, "Brother", "9300000005", priority=3).json()
    client.delete(f"/api/v1/contacts/{brother['id']}", headers=headers)  # soft-deleted

    assert sync(client, headers, user, "dev3d_1", "evt_d1") == "SYNCED"

    assert [p for p, _ in capture.sent] == ["+919300000002", "+919300000003"]  # Mom (1), Sister (2)
    records = logs(client, headers, "evt_d1")
    assert [(r["contact_name"], r["status"], r["is_simulated"]) for r in records] == [
        ("Mom", "PROVIDER_ACCEPTED", True),
        ("Sister", "PROVIDER_ACCEPTED", True),
    ]


def test_d1_repeated_syncs_never_resend(client, capture):
    headers, user = register(client, "+919300000010", "dev3d_2")
    add_contact(client, headers, "Mom", "9300000011")
    sync(client, headers, user, "dev3d_2", "evt_d1_repeat")
    assert sync(client, headers, user, "dev3d_2", "evt_d1_repeat") == "ALREADY_SYNCED"
    sync(client, headers, user, "dev3d_2", "evt_d1_repeat", updated=CREATED_MS + 1000)  # UPDATED, still open
    assert len(capture.sent) == 1
    assert logs(client, headers, "evt_d1_repeat")[0]["attempt_count"] == 1


def test_d1_no_contacts_creates_no_records(client, capture):
    headers, user = register(client, "+919300000012", "dev3d_3")
    sync(client, headers, user, "dev3d_3", "evt_d1_none")
    assert capture.sent == []
    assert logs(client, headers, "evt_d1_none") == []


def test_d1_dispatch_failure_never_affects_sync_or_emergency(client, db_session):
    headers, user = register(client, "+919300000013", "dev3d_4")
    add_contact(client, headers, "Mom", "9300000014")

    def broken_registry():
        raise RuntimeError("registry exploded")

    app.dependency_overrides[get_provider_registry_factory] = lambda: broken_registry
    try:
        assert sync(client, headers, user, "dev3d_4", "evt_d1_broken") == "SYNCED"
    finally:
        app.dependency_overrides.pop(get_provider_registry_factory, None)
    event = db_session.query(EmergencyEvent).filter(EmergencyEvent.event_id == "evt_d1_broken").first()
    assert event.state == EmergencyStateEnum.RESPONDING


# ---------------------------------------------------------------- D2 already closed on arrival

@pytest.mark.parametrize("state,reason", [
    ("RESOLVED", "emergency_already_resolved"),
    ("CANCELLED", "emergency_already_cancelled"),
])
def test_d2_closed_on_arrival_is_not_sent(client, capture, db_session, state, reason):
    headers, user = register(client, f"+91930000002{0 if state == 'RESOLVED' else 1}", f"dev3d_d2_{state}")
    add_contact(client, headers, "Mom", f"93000000{3 if state == 'RESOLVED' else 4}0")
    sync(client, headers, user, f"dev3d_d2_{state}", f"evt_d2_{state}", state=state)

    assert capture.sent == []
    records = logs(client, headers, f"evt_d2_{state}")
    assert [(r["status"], r["reason_code"], r["attempt_count"]) for r in records] == [("NOT_SENT", reason, 0)]
    event = db_session.query(EmergencyEvent).filter(EmergencyEvent.event_id == f"evt_d2_{state}").first()
    assert event.state.value == state  # never resurrected


# ---------------------------------------------------------------- D3 limits

def test_d3_max_five_active_and_ten_total(client):
    headers, _ = register(client, "+919300000050", "dev3d_d3")
    for i in range(5):
        assert add_contact(client, headers, f"A{i}", f"93000001{i:02d}").status_code == 201
    sixth = add_contact(client, headers, "A5", "9300000105")
    assert sixth.status_code == status.HTTP_409_CONFLICT
    assert "at most 5 active" in sixth.json()["detail"]

    inactive_ids = []
    for i in range(5):
        resp = add_contact(client, headers, f"I{i}", f"93000002{i:02d}", active=False)
        assert resp.status_code == 201
        inactive_ids.append(resp.json()["id"])
    eleventh = add_contact(client, headers, "X", "9300000300", active=False)
    assert eleventh.status_code == status.HTTP_409_CONFLICT
    assert "at most 10" in eleventh.json()["detail"]

    activate = client.patch(f"/api/v1/contacts/{inactive_ids[0]}", json={"is_active": True}, headers=headers)
    assert activate.status_code == status.HTTP_409_CONFLICT


def test_d3_limits_count_only_live_contacts(client):
    headers, _ = register(client, "+919300000051", "dev3d_d3b")
    ids = [add_contact(client, headers, f"A{i}", f"93000004{i:02d}").json()["id"] for i in range(5)]
    client.delete(f"/api/v1/contacts/{ids[0]}", headers=headers)
    assert add_contact(client, headers, "Replacement", "9300000499").status_code == 201


# ---------------------------------------------------------------- D4 resolved during dispatch

@pytest.mark.asyncio
async def test_d4_resolved_mid_dispatch_stops_remaining_sends(client, db_session):
    headers, user = register(client, "+919300000060", "dev3d_d4")
    sync(client, headers, user, "dev3d_d4", "evt_d4")  # no contacts yet → nothing sent
    for i, name in enumerate(["First", "Second", "Third"]):
        add_contact(client, headers, name, f"930000006{i + 1}", priority=i + 1)

    class ResolvingProvider(MockSmsProvider):
        async def send_dispatch(self, log, contact, message):
            result = await super().send_dispatch(log, contact, message)
            # The user resolves the emergency while the first alert is being sent.
            db_session.query(EmergencyEvent).filter(EmergencyEvent.event_id == "evt_d4").update(
                {EmergencyEvent.state: EmergencyStateEnum.RESOLVED}
            )
            db_session.commit()
            return result

    provider = ResolvingProvider()
    summary = await dispatch_emergency_communications(
        db_session, uuid.UUID(user), "evt_d4",
        provider_registry=ProviderRegistry(overrides={CommunicationChannelEnum.SMS: provider}),
    )
    assert provider.call_count == 1
    assert [(a.contact_name, a.status.value, a.reason_code) for a in summary.attempts] == [
        ("First", "PROVIDER_ACCEPTED", None),
        ("Second", "NOT_SENT", "dispatch_cancelled_emergency_resolved"),
        ("Third", "NOT_SENT", "dispatch_cancelled_emergency_resolved"),
    ]
    event = db_session.query(EmergencyEvent).filter(EmergencyEvent.event_id == "evt_d4").first()
    assert event.state == EmergencyStateEnum.RESOLVED


def test_d4_resolve_sync_finalizes_unsent_records(client, db_session):
    headers, user = register(client, "+919300000070", "dev3d_d4b")
    sync(client, headers, user, "dev3d_d4b", "evt_d4b")
    contact = add_contact(client, headers, "Mom", "9300000071").json()
    # A record waiting to be sent (e.g. dispatch interrupted).
    db_session.add(EmergencyCommunicationLog(
        event_id="evt_d4b", contact_id=uuid.UUID(contact["id"]), channel=CommunicationChannelEnum.SMS,
        status=CommunicationStatusEnum.QUEUED, attempt_count=0, is_simulated=False,
    ))
    db_session.commit()

    sync(client, headers, user, "dev3d_d4b", "evt_d4b", state="RESOLVED", updated=CREATED_MS + 5000)
    record = logs(client, headers, "evt_d4b")[0]
    assert (record["status"], record["reason_code"]) == ("NOT_SENT", "dispatch_cancelled_emergency_resolved")


# ---------------------------------------------------------------- D5 server-built message

def test_d5_message_without_location(client, capture):
    headers, user = register(client, "+919300000080", "dev3d_d5a")
    add_contact(client, headers, "Mom", "9300000081")
    sync(client, headers, user, "dev3d_d5a", "evt_d5a", trigger="VOICE")
    assert capture.sent[0][1] == (
        "SheGuard ALERT: +919300000080 triggered an emergency (Voice) at 05:30 IST.\n"
        "Please check on them."
    )


def test_d5_message_uses_server_stored_location_and_ignores_client_text(client, capture):
    headers, user = register(client, "+919300000082", "dev3d_d5b")
    sync(client, headers, user, "dev3d_d5b", "evt_d5b", trigger="GESTURE")  # no contacts yet
    loc = client.post("/api/v1/emergencies/evt_d5b/locations/sync", json={"points": [
        {"locationId": "loc-d5b-1", "kind": "SNAPSHOT", "latitude": 19.28187, "longitude": 72.86841,
         "accuracyMeters": 12.0, "provider": "FUSED", "capturedAt": CREATED_MS + 2000},
    ]}, headers=headers)
    assert loc.status_code == status.HTTP_200_OK, loc.json()
    add_contact(client, headers, "Mom", "9300000083")

    # The client tries to inject text and channels: ignored.
    resp = client.post("/api/v1/emergencies/evt_d5b/dispatch", json={
        "channels": ["FCM"], "location_info": "click http://evil.example",
    }, headers=headers)
    assert resp.status_code == status.HTTP_200_OK
    assert [a["channel"] for a in resp.json()["attempts"]] == ["SMS"]
    message = capture.sent[0][1]
    assert message == (
        "SheGuard ALERT: +919300000082 triggered an emergency (Shake) at 05:30 IST.\n"
        "Location: https://www.google.com/maps/search/?api=1&query=19.28187%2C72.86841\n"  # Phase 3E link
        "Please check on them."
    )
    assert "evil" not in message


# ---------------------------------------------------------------- D6 / D9 truthful outcomes, bounded attempts

class TimeoutProvider(MockSmsProvider):
    async def send_dispatch(self, log, contact, message):
        self.call_count += 1
        return ProviderResponse(
            success=False, status=CommunicationStatusEnum.FAILED, failed_at=datetime.now(timezone.utc),
            failure_reason="Fast2SMS gateway HTTP timeout", is_retryable=True, is_timeout=True, simulated=True,
        )


async def _dispatch_with(db_session, client, phone, device, event_id, provider):
    headers, user = register(client, phone, device)
    sync(client, headers, user, device, event_id)
    add_contact(client, headers, "Mom", f"9{phone[-9:]}" if phone[-10] != "9" else "9399999999")
    registry = ProviderRegistry(overrides={CommunicationChannelEnum.SMS: provider})
    summary = await dispatch_emergency_communications(db_session, uuid.UUID(user), event_id, provider_registry=registry)
    return headers, user, summary, registry


@pytest.mark.asyncio
async def test_d9_timeouts_three_attempts_then_uncertain_never_delivered(client, db_session):
    provider = TimeoutProvider()
    _, user, summary, registry = await _dispatch_with(db_session, client, "+919300000090", "dev3d_d9a", "evt_d9a", provider)
    assert provider.call_count == 3
    item = summary.attempts[0]
    assert (item.status, item.reason_code, item.attempt_count) == (CommunicationStatusEnum.UNCERTAIN, "provider_timeout", 3)

    # Bounded across runs: dispatching again never makes a 4th provider call.
    await dispatch_emergency_communications(db_session, uuid.UUID(user), "evt_d9a", provider_registry=registry)
    assert provider.call_count == 3


@pytest.mark.asyncio
async def test_d9_rejection_is_terminal_failed_after_one_attempt(client, db_session):
    provider = MockSmsProvider(should_fail=True, is_retryable=False, failure_reason="Invalid number")
    _, _, summary, _ = await _dispatch_with(db_session, client, "+919300000091", "dev3d_d9b", "evt_d9b", provider)
    assert provider.call_count == 1
    item = summary.attempts[0]
    assert (item.status, item.reason_code, item.attempt_count) == (CommunicationStatusEnum.FAILED, "provider_rejected", 1)


@pytest.mark.asyncio
async def test_d9_retry_then_accepted(client, db_session):
    class FlakyProvider(MockSmsProvider):
        async def send_dispatch(self, log, contact, message):
            if self.call_count == 0:
                self.call_count += 1
                return ProviderResponse(success=False, status=CommunicationStatusEnum.FAILED,
                                        failure_reason="HTTP 503", is_retryable=True, simulated=True)
            return await super().send_dispatch(log, contact, message)

    provider = FlakyProvider()
    _, _, summary, _ = await _dispatch_with(db_session, client, "+919300000092", "dev3d_d9c", "evt_d9c", provider)
    item = summary.attempts[0]
    assert (item.status, item.attempt_count, item.is_simulated) == (CommunicationStatusEnum.PROVIDER_ACCEPTED, 2, True)


@pytest.mark.asyncio
async def test_claim_prevents_concurrent_double_send_but_recovers_abandoned_records(client, db_session):
    headers, user = register(client, "+919300000093", "dev3d_claim")
    sync(client, headers, user, "dev3d_claim", "evt_claim")
    contact = add_contact(client, headers, "Mom", "9300000094").json()
    log = EmergencyCommunicationLog(
        event_id="evt_claim", contact_id=uuid.UUID(contact["id"]), channel=CommunicationChannelEnum.SMS,
        status=CommunicationStatusEnum.DISPATCHED, attempt_count=0, is_simulated=False,
    )
    db_session.add(log)
    db_session.commit()

    provider = MockSmsProvider()
    registry = ProviderRegistry(overrides={CommunicationChannelEnum.SMS: provider})
    # Another run owns it (fresh DISPATCHED): not sent again.
    await dispatch_emergency_communications(db_session, uuid.UUID(user), "evt_claim", provider_registry=registry)
    assert provider.call_count == 0

    # Abandoned (server restarted mid-send): claimable again.
    log.updated_at = datetime.now(timezone.utc) - timedelta(seconds=settings.DISPATCH_STALE_CLAIM_SECONDS + 60)
    db_session.add(log)
    db_session.commit()
    db_session.query(EmergencyCommunicationLog).filter(EmergencyCommunicationLog.id == log.id).update(
        {EmergencyCommunicationLog.updated_at: datetime.now(timezone.utc) - timedelta(seconds=settings.DISPATCH_STALE_CLAIM_SECONDS + 60)},
        synchronize_session=False,
    )
    db_session.commit()
    summary = await dispatch_emergency_communications(db_session, uuid.UUID(user), "evt_claim", provider_registry=registry)
    assert provider.call_count == 1
    assert summary.attempts[0].status == CommunicationStatusEnum.PROVIDER_ACCEPTED


# ---------------------------------------------------------------- D7 phone normalization and duplicates

@pytest.mark.parametrize("raw", ["9876500001", "09876500001", "+91 98765 00001", "919876500001", "+91-98765-00001"])
def test_d7_numbers_normalize_to_plus91(client, raw):
    headers, _ = register(client, f"+9193{abs(hash(raw)) % 10**8:08d}", f"dev3d_d7_{abs(hash(raw)) % 10**6}")
    resp = add_contact(client, headers, "Mom", raw)
    assert resp.status_code == 201, resp.json()
    assert resp.json()["phone"] == "+919876500001"


@pytest.mark.parametrize("raw", ["12345", "+14155550100", "5876500001", "98765000011", "+91 1234567890", "abcdefghij"])
def test_d7_invalid_or_non_indian_numbers_rejected(client, raw):
    headers, _ = register(client, f"+9192{abs(hash(raw)) % 10**8:08d}", f"dev3d_d7i_{abs(hash(raw)) % 10**6}")
    assert add_contact(client, headers, "X", raw).status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


def test_d7_duplicates_rejected_in_any_format_and_on_update(client):
    headers, _ = register(client, "+919300000100", "dev3d_d7d")
    first = add_contact(client, headers, "Mom", "9876500002").json()
    dup = add_contact(client, headers, "Mom again", "+91 98765 00002")
    assert dup.status_code == status.HTTP_409_CONFLICT
    other = add_contact(client, headers, "Dad", "9876500003").json()
    upd = client.patch(f"/api/v1/contacts/{other['id']}", json={"phone": "09876500002"}, headers=headers)
    assert upd.status_code == status.HTTP_409_CONFLICT
    # Same number on a different account is fine.
    headers_b, _ = register(client, "+919300000101", "dev3d_d7e")
    assert add_contact(client, headers_b, "Mom", "9876500002").status_code == 201
    # After removal, the number can be added again.
    client.delete(f"/api/v1/contacts/{first['id']}", headers=headers)
    assert add_contact(client, headers, "Mom (new)", "9876500002").status_code == 201


# ---------------------------------------------------------------- D8 soft delete keeps history

def test_d8_soft_delete_keeps_history_and_stops_future_alerts(client, capture):
    headers, user = register(client, "+919300000110", "dev3d_d8")
    mom = add_contact(client, headers, "Mom", "9300000111").json()
    sync(client, headers, user, "dev3d_d8", "evt_d8_before")
    assert len(capture.sent) == 1

    assert client.delete(f"/api/v1/contacts/{mom['id']}", headers=headers).status_code == 204
    assert client.get(f"/api/v1/contacts/{mom['id']}", headers=headers).status_code == 404
    assert client.get("/api/v1/contacts?include_inactive=true", headers=headers).json() == []

    history = logs(client, headers, "evt_d8_before")
    assert (history[0]["contact_name"], history[0]["contact_deleted"], history[0]["status"]) == ("Mom", True, "PROVIDER_ACCEPTED")

    sync(client, headers, user, "dev3d_d8", "evt_d8_after")
    assert len(capture.sent) == 1  # the removed contact is not alerted again
    assert logs(client, headers, "evt_d8_after") == []


# ---------------------------------------------------------------- ownership

def test_other_user_cannot_dispatch_or_modify(client):
    headers_a, user_a = register(client, "+919300000120", "dev3d_own_a")
    headers_b, _ = register(client, "+919300000121", "dev3d_own_b")
    mom = add_contact(client, headers_a, "Mom", "9300000122").json()
    sync(client, headers_a, user_a, "dev3d_own_a", "evt_own")
    assert client.post("/api/v1/emergencies/evt_own/dispatch", headers=headers_b).status_code in (403, 404)
    assert client.patch(f"/api/v1/contacts/{mom['id']}", json={"is_active": False}, headers=headers_b).status_code == 404
    assert client.delete(f"/api/v1/contacts/{mom['id']}", headers=headers_b).status_code == 404
