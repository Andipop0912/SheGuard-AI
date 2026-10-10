import asyncio
import logging
import time
import uuid
from contextlib import AbstractContextManager
from datetime import datetime, timedelta, timezone
from typing import Callable, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models.communication_log import (
    EmergencyCommunicationLog,
    CommunicationChannelEnum,
    CommunicationStatusEnum,
)
from app.db.models.emergency_event import EmergencyEvent, EmergencyStateEnum
from app.db.models.emergency_location import EmergencyLocation
from app.db.models.trusted_contact import TrustedContact
from app.db.models.user import User
from app.schemas.communication import (
    CommunicationLogDTO,
    DispatchEmergencyRequest,
    DispatchAttemptSummary,
    EmergencyDispatchSummary,
)
from app.services.communication_provider import ProviderRegistry, ProviderResponse
from app.services.message_builder import EmergencyMessageBuilder, latest_stored_location

logger = logging.getLogger(__name__)

CLOSED_STATES = {EmergencyStateEnum.RESOLVED, EmergencyStateEnum.CANCELLED}
# Records that will not change any more.
FINAL_STATUSES = {
    CommunicationStatusEnum.PROVIDER_ACCEPTED,
    CommunicationStatusEnum.DELIVERED,
    CommunicationStatusEnum.FAILED,
    CommunicationStatusEnum.NOT_SENT,
    CommunicationStatusEnum.UNCERTAIN,
}

# reason_code values (machine-readable; shown truthfully by the app).
REASON_ALREADY_RESOLVED = "emergency_already_resolved"
REASON_ALREADY_CANCELLED = "emergency_already_cancelled"
REASON_STOPPED_RESOLVED = "dispatch_cancelled_emergency_resolved"
REASON_STOPPED_CANCELLED = "dispatch_cancelled_emergency_cancelled"
REASON_CHANNEL_UNAVAILABLE = "channel_not_available"
REASON_PROVIDER_REJECTED = "provider_rejected"
REASON_PROVIDER_TIMEOUT = "provider_timeout"
REASON_PROVIDER_ERROR = "provider_error"


def max_total_attempts() -> int:
    """Provider calls allowed per record over its whole lifetime (1 + MAX_DISPATCH_RETRIES)."""
    return 1 + settings.MAX_DISPATCH_RETRIES


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _closed_reason(event: EmergencyEvent, already_closed_on_arrival: bool) -> str:
    resolved = event.state == EmergencyStateEnum.RESOLVED
    if already_closed_on_arrival:
        return REASON_ALREADY_RESOLVED if resolved else REASON_ALREADY_CANCELLED
    return REASON_STOPPED_RESOLVED if resolved else REASON_STOPPED_CANCELLED


def _load_owned_event(db: Session, user_id: uuid.UUID, event_id: str) -> EmergencyEvent:
    event = db.query(EmergencyEvent).filter(EmergencyEvent.event_id == event_id, EmergencyEvent.user_id == user_id).first()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Emergency event not found")
    return event


def _active_contacts(db: Session, user_id: uuid.UUID) -> List[TrustedContact]:
    """ACTIVE, not deleted, priority ASC (1 = highest) then creation time ASC."""
    return (
        db.query(TrustedContact)
        .filter(
            TrustedContact.user_id == user_id,
            TrustedContact.is_active == True,
            TrustedContact.deleted_at.is_(None),
        )
        .order_by(TrustedContact.priority.asc(), TrustedContact.created_at.asc())
        .all()
    )


def _find_log(db: Session, event_id: str, contact_id: uuid.UUID, channel: CommunicationChannelEnum):
    return (
        db.query(EmergencyCommunicationLog)
        .filter(
            EmergencyCommunicationLog.event_id == event_id,
            EmergencyCommunicationLog.contact_id == contact_id,
            EmergencyCommunicationLog.channel == channel,
        )
        .first()
    )


def _get_or_create_log(
    db: Session,
    event_id: str,
    contact: TrustedContact,
    channel: CommunicationChannelEnum,
    initial_status: CommunicationStatusEnum = CommunicationStatusEnum.QUEUED,
    reason_code: Optional[str] = None,
) -> EmergencyCommunicationLog:
    """One record per (event, contact, channel); a concurrent creator wins the unique constraint."""
    log = _find_log(db, event_id, contact.id, channel)
    if log:
        return log
    log = EmergencyCommunicationLog(
        event_id=event_id,
        contact_id=contact.id,
        channel=channel,
        status=initial_status,
        reason_code=reason_code,
        attempt_count=0,
        is_simulated=False,
    )
    db.add(log)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        log = _find_log(db, event_id, contact.id, channel)
    db.refresh(log)
    return log


def _mark_not_sent(db: Session, log: EmergencyCommunicationLog, reason_code: str) -> None:
    log.status = CommunicationStatusEnum.NOT_SENT
    log.reason_code = reason_code
    log.failure_reason = None
    db.add(log)
    db.commit()


def _claim(db: Session, log: EmergencyCommunicationLog) -> bool:
    """
    Atomically takes a record for sending: QUEUED, or DISPATCHED but abandoned (e.g. server restart),
    and only while attempts remain. Two dispatch runs can never both send the same record.
    """
    stale_before = _now() - timedelta(seconds=settings.DISPATCH_STALE_CLAIM_SECONDS)
    claimed = (
        db.query(EmergencyCommunicationLog)
        .filter(
            EmergencyCommunicationLog.id == log.id,
            EmergencyCommunicationLog.attempt_count < max_total_attempts(),
            or_(
                EmergencyCommunicationLog.status == CommunicationStatusEnum.QUEUED,
                (EmergencyCommunicationLog.status == CommunicationStatusEnum.DISPATCHED)
                & (EmergencyCommunicationLog.updated_at < stale_before),
            ),
        )
        .update(
            {
                EmergencyCommunicationLog.status: CommunicationStatusEnum.DISPATCHED,
                EmergencyCommunicationLog.attempted_at: _now(),
                EmergencyCommunicationLog.updated_at: _now(),
            },
            synchronize_session=False,
        )
    )
    db.commit()
    db.refresh(log)
    return claimed == 1


def _event_closed(db: Session, event: EmergencyEvent) -> bool:
    db.refresh(event)
    return event.state in CLOSED_STATES


def _summary_item(log: EmergencyCommunicationLog, contact: TrustedContact) -> DispatchAttemptSummary:
    return DispatchAttemptSummary(
        id=log.id,
        contact_id=contact.id,
        contact_name=contact.name,
        contact_phone=contact.phone,
        channel=log.channel,
        status=log.status,
        reason_code=log.reason_code,
        is_simulated=bool(log.is_simulated),
        attempt_count=log.attempt_count or 0,
        provider_message_id=log.provider_message_id,
        failure_reason=log.failure_reason,
        attempted_at=log.attempted_at,
    )


async def _wait_for_location(db: Session, event: EmergencyEvent, grace_seconds: float) -> None:
    """Gives the phone a moment to upload the emergency's first location (it does so right after sync)."""
    deadline = time.monotonic() + max(0.0, grace_seconds)
    while time.monotonic() < deadline:
        db.expire_all()
        if db.query(EmergencyLocation.id).filter(EmergencyLocation.event_id == event.event_id).first():
            return
        if _event_closed(db, event):
            return
        await asyncio.sleep(0.5)


async def _send_with_bounded_attempts(
    db: Session,
    event: EmergencyEvent,
    log: EmergencyCommunicationLog,
    contact: TrustedContact,
    provider,
    message: str,
) -> None:
    """Up to max_total_attempts() provider calls for this record, ever. Records the truthful outcome."""
    response: Optional[ProviderResponse] = None
    while log.attempt_count < max_total_attempts():
        # D4: never start another provider attempt once the emergency is closed.
        if _event_closed(db, event):
            if log.attempt_count == 0:
                _mark_not_sent(db, log, _closed_reason(event, already_closed_on_arrival=False))
                return
            break

        # Count the attempt before calling the provider so a crash can never exceed the bound.
        log.attempt_count = (log.attempt_count or 0) + 1
        db.add(log)
        db.commit()

        try:
            response = await provider.send_dispatch(log, contact, message)
        except Exception as exc:
            logger.error(f"Provider exception for log {log.id}: {type(exc).__name__}")
            response = ProviderResponse(
                success=False,
                status=CommunicationStatusEnum.FAILED,
                failed_at=_now(),
                failure_reason=f"Provider exception: {str(exc)}",
                is_retryable=False,
            )
        log.is_simulated = bool(log.is_simulated or response.simulated)
        if response.success or not response.is_retryable:
            break

    if response is None:
        # No provider call in this run (emergency closed) but an earlier, interrupted run had made one:
        # it may or may not have gone out.
        log.status = CommunicationStatusEnum.UNCERTAIN
        log.reason_code = _closed_reason(event, already_closed_on_arrival=False)
        db.add(log)
        db.commit()
        db.refresh(log)
        return

    if response.success:
        if response.status == CommunicationStatusEnum.DELIVERED and response.supports_delivery_confirmation:
            log.status = CommunicationStatusEnum.DELIVERED
            log.delivered_at = response.delivered_at
        else:
            log.status = CommunicationStatusEnum.PROVIDER_ACCEPTED
            log.provider_accepted_at = response.accepted_at or _now()
        log.provider_message_id = response.provider_message_id
        log.failure_reason = None
        log.reason_code = None
    elif response.is_timeout:
        # No answer from the provider: it may or may not have been sent. Never reported as delivered.
        log.status = CommunicationStatusEnum.UNCERTAIN
        log.reason_code = REASON_PROVIDER_TIMEOUT
        log.failure_reason = response.failure_reason
        log.failed_at = response.failed_at or _now()
    else:
        log.status = CommunicationStatusEnum.FAILED
        log.reason_code = REASON_PROVIDER_ERROR if response.is_retryable else REASON_PROVIDER_REJECTED
        log.failure_reason = response.failure_reason or "Dispatch failed"
        log.failed_at = response.failed_at or _now()

    db.add(log)
    db.commit()
    db.refresh(log)


async def dispatch_emergency_communications(
    db: Session,
    user_id: uuid.UUID,
    event_id: str,
    dispatch_req: Optional[DispatchEmergencyRequest] = None,
    provider_registry: Optional[ProviderRegistry] = None,
    location_grace_seconds: float = 0.0,
    first_arrival: bool = False,
) -> EmergencyDispatchSummary:
    """
    Communication Dispatch Engine (server-owned; the emergency lifecycle is never changed here).

    1. Verifies the emergency belongs to the user.
    2. ACTIVE, not deleted contacts only, priority ASC then created_at ASC.
    3. Closed emergency: nothing is sent. On first arrival every active contact gets a NOT_SENT record
       (emergency_already_resolved / _cancelled); otherwise unsent records become NOT_SENT.
    4. Open emergency: one record per (event, contact, channel); each is claimed atomically before
       sending; at most max_total_attempts() provider calls per record, ever; the emergency state
       is re-checked before every provider call (resolved/cancelled → remaining records NOT_SENT).
    5. Channels without a provider (FCM, VOICE_CALL) are recorded NOT_SENT (channel_not_available).
    """
    event = _load_owned_event(db, user_id, event_id)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    contacts = _active_contacts(db, user_id)
    channels = (dispatch_req.channels if dispatch_req and dispatch_req.channels else None) or [
        CommunicationChannelEnum.SMS
    ]
    registry = provider_registry or ProviderRegistry()

    if not contacts:
        logger.info(f"No active trusted contacts for emergency {event_id}")
        _finalize_unsent(db, event)
        return EmergencyDispatchSummary(
            event_id=event_id, total_contacts=0, total_attempts=0,
            successful_attempts=0, failed_attempts=0, attempts=[],
        )

    if event.state in CLOSED_STATES:
        if first_arrival and not db.query(EmergencyCommunicationLog.id).filter(
            EmergencyCommunicationLog.event_id == event_id
        ).first():
            reason = _closed_reason(event, already_closed_on_arrival=True)
            for contact in contacts:
                for channel in channels:
                    _get_or_create_log(db, event_id, contact, channel, CommunicationStatusEnum.NOT_SENT, reason)
        _finalize_unsent(db, event)
        return _build_summary(db, event_id, contacts, channels)

    # Open emergency: create the records first so the app can show progress immediately.
    for contact in contacts:
        for channel in channels:
            log = _get_or_create_log(db, event_id, contact, channel)
            if registry.get_provider(channel) is None and log.status == CommunicationStatusEnum.QUEUED:
                _mark_not_sent(db, log, REASON_CHANNEL_UNAVAILABLE)

    if location_grace_seconds > 0:
        await _wait_for_location(db, event, location_grace_seconds)
    location = latest_stored_location(db, event_id)

    for contact in contacts:
        for channel in channels:
            try:
                log = _find_log(db, event_id, contact.id, channel)
                if log is None or log.status in FINAL_STATUSES:
                    continue
                if _event_closed(db, event):
                    _finalize_unsent(db, event)
                    break
                provider = registry.get_provider(channel)
                if provider is None:
                    _mark_not_sent(db, log, REASON_CHANNEL_UNAVAILABLE)
                    continue
                if not _claim(db, log):
                    continue  # another run owns it, or no attempts remain
                message = EmergencyMessageBuilder.build_emergency_message(
                    event=event, user=user, contact=contact, channel=channel, location=location,
                )
                await _send_with_bounded_attempts(db, event, log, contact, provider, message)
            except Exception as exc:
                db.rollback()
                logger.error(f"Failure isolated for contact {contact.id} channel {channel}: {type(exc).__name__}")

    return _build_summary(db, event_id, contacts, channels)


def _finalize_unsent(db: Session, event: EmergencyEvent) -> None:
    """Closed emergency: records never sent (QUEUED, or abandoned DISPATCHED with no attempt) → NOT_SENT."""
    if event.state not in CLOSED_STATES:
        return
    reason = _closed_reason(event, already_closed_on_arrival=False)
    pending = (
        db.query(EmergencyCommunicationLog)
        .filter(
            EmergencyCommunicationLog.event_id == event.event_id,
            or_(
                EmergencyCommunicationLog.status == CommunicationStatusEnum.QUEUED,
                (EmergencyCommunicationLog.status == CommunicationStatusEnum.DISPATCHED)
                & (EmergencyCommunicationLog.attempt_count == 0),
            ),
        )
        .all()
    )
    for log in pending:
        _mark_not_sent(db, log, reason)


def _build_summary(
    db: Session, event_id: str, contacts: List[TrustedContact], channels: List[CommunicationChannelEnum]
) -> EmergencyDispatchSummary:
    items: List[DispatchAttemptSummary] = []
    successful = failed = 0
    for contact in contacts:
        for channel in channels:
            log = _find_log(db, event_id, contact.id, channel)
            if log is None:
                continue
            db.refresh(log)
            items.append(_summary_item(log, contact))
            if log.status in (CommunicationStatusEnum.PROVIDER_ACCEPTED, CommunicationStatusEnum.DELIVERED):
                successful += 1
            elif log.status in (CommunicationStatusEnum.FAILED, CommunicationStatusEnum.UNCERTAIN):
                failed += 1
    return EmergencyDispatchSummary(
        event_id=event_id,
        total_contacts=len(contacts),
        total_attempts=len(items),
        successful_attempts=successful,
        failed_attempts=failed,
        attempts=items,
    )


async def run_dispatch_after_sync(
    session_scope: Callable[[], AbstractContextManager],
    registry_factory: Callable[[], ProviderRegistry],
    user_id: uuid.UUID,
    event_id: str,
    first_arrival: bool,
) -> None:
    """
    Background entry point scheduled by POST /emergencies/sync (after the sync response).
    Never raises: communication problems can never affect the emergency or the sync.
    """
    try:
        with session_scope() as db:
            event = db.query(EmergencyEvent).filter(EmergencyEvent.event_id == event_id).first()
            if event is None or event.user_id != user_id:
                return
            grace = settings.DISPATCH_LOCATION_GRACE_SECONDS if first_arrival and event.state not in CLOSED_STATES else 0.0
            await dispatch_emergency_communications(
                db,
                user_id,
                event_id,
                provider_registry=registry_factory(),
                location_grace_seconds=grace,
                first_arrival=first_arrival,
            )
    except Exception as exc:
        logger.error(f"Background dispatch for emergency {event_id} failed: {type(exc).__name__}")


def get_event_communication_logs(db: Session, user_id: uuid.UUID, event_id: str) -> List[CommunicationLogDTO]:
    _load_owned_event(db, user_id, event_id)
    rows = (
        db.query(EmergencyCommunicationLog, TrustedContact)
        .join(TrustedContact, TrustedContact.id == EmergencyCommunicationLog.contact_id)
        .filter(EmergencyCommunicationLog.event_id == event_id)
        .order_by(TrustedContact.priority.asc(), TrustedContact.created_at.asc(), EmergencyCommunicationLog.channel.asc())
        .all()
    )
    return [
        CommunicationLogDTO(
            id=log.id,
            event_id=log.event_id,
            contact_id=contact.id,
            contact_name=contact.name,
            contact_phone=contact.phone,
            contact_deleted=contact.deleted_at is not None,
            channel=log.channel,
            status=log.status,
            reason_code=log.reason_code,
            failure_reason=log.failure_reason,
            is_simulated=bool(log.is_simulated),
            attempt_count=log.attempt_count or 0,
            provider_message_id=log.provider_message_id,
            attempted_at=log.attempted_at,
            provider_accepted_at=log.provider_accepted_at,
            delivered_at=log.delivered_at,
            failed_at=log.failed_at,
            created_at=log.created_at,
            updated_at=log.updated_at,
        )
        for log, contact in rows
    ]
