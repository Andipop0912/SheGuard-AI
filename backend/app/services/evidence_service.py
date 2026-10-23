import hashlib
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.db.models.communication_log import CommunicationChannelEnum, CommunicationStatusEnum
from app.db.models.emergency_event import EmergencyEvent
from app.db.models.emergency_location import EmergencyLocation
from app.db.models.evidence import EvidenceDeliveryLog, EvidenceItem, EvidenceUploadStatusEnum, IncidentReport
from app.db.models.trusted_contact import TrustedContact
from app.db.models.user import User
from app.services.communication_provider import ProviderRegistry
from app.services.communication_service import _active_contacts, _load_owned_event
from app.services.pdf_report_service import build_incident_report_pdf
from app.services.route_safety_message_builder import log_shim
from app.services.supabase_storage import SupabaseStorageClient

logger = logging.getLogger(__name__)

IST = timezone(timedelta(hours=5, minutes=30), name="IST")

REASON_CHANNEL_UNAVAILABLE = "channel_not_available"
REASON_PROVIDER_ERROR = "provider_error"


def _event_communication_logs(db: Session, event_id: str):
    from app.db.models.communication_log import EmergencyCommunicationLog
    return db.query(EmergencyCommunicationLog).filter(EmergencyCommunicationLog.event_id == event_id).all()


async def upload_evidence_item(
    db: Session,
    user: User,
    event_id: str,
    evidence_id: str,
    file_bytes: bytes,
    file_name: str,
    mime_type: str,
    duration_ms: Optional[int],
    client_created_at: int,
    storage: SupabaseStorageClient,
) -> EvidenceItem:
    event = _load_owned_event(db, user.id, event_id)

    item = db.query(EvidenceItem).filter(EvidenceItem.evidence_id == evidence_id).first()
    if item is None:
        item = EvidenceItem(
            evidence_id=evidence_id,
            event_id=event.event_id,
            user_id=user.id,
            type="AUDIO",
            file_name=file_name,
            mime_type=mime_type,
            duration_ms=duration_ms,
            size_bytes=len(file_bytes),
            checksum=hashlib.sha256(file_bytes).hexdigest(),
            client_created_at=client_created_at,
            upload_status=EvidenceUploadStatusEnum.PENDING,
        )
        db.add(item)
    elif item.event_id != event.event_id or item.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Evidence item belongs to a different incident")

    path = f"{user.id}/{event.event_id}/evidence/{evidence_id}.m4a"
    result = await storage.upload(path, file_bytes, mime_type)
    if result.success:
        item.storage_bucket = result.bucket
        item.storage_path = result.path
        item.upload_status = EvidenceUploadStatusEnum.UPLOADED
        item.upload_error = None
    else:
        # Local copy on the device remains the source of truth either way; only the cloud
        # upload state reflects failure. Never raises — the emergency path must stay unaffected.
        item.upload_status = EvidenceUploadStatusEnum.FAILED
        item.upload_error = result.error

    db.commit()
    db.refresh(item)
    return item


async def get_evidence_download_url(db: Session, user: User, evidence_id: str, storage: SupabaseStorageClient) -> Optional[str]:
    item = db.query(EvidenceItem).filter(EvidenceItem.evidence_id == evidence_id, EvidenceItem.user_id == user.id).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evidence item not found")
    if item.upload_status != EvidenceUploadStatusEnum.UPLOADED or not item.storage_path:
        return None
    return await storage.create_signed_url(item.storage_path)


async def generate_and_upload_report(db: Session, user: User, event_id: str, storage: SupabaseStorageClient) -> IncidentReport:
    event = _load_owned_event(db, user.id, event_id)
    locations: List[EmergencyLocation] = db.query(EmergencyLocation).filter(EmergencyLocation.event_id == event.event_id).all()
    comm_logs = _event_communication_logs(db, event.event_id)
    evidence_items = db.query(EvidenceItem).filter(EvidenceItem.event_id == event.event_id).all()

    pdf_bytes = build_incident_report_pdf(event, locations, comm_logs, evidence_items)

    report_id = f"rep-{uuid.uuid4().hex[:16]}"
    path = f"{user.id}/{event.event_id}/reports/{report_id}.pdf"
    result = await storage.upload(path, pdf_bytes, "application/pdf")

    report = IncidentReport(
        report_id=report_id,
        event_id=event.event_id,
        user_id=user.id,
        size_bytes=len(pdf_bytes),
        upload_status=EvidenceUploadStatusEnum.UPLOADED if result.success else EvidenceUploadStatusEnum.FAILED,
        upload_error=None if result.success else result.error,
        storage_bucket=result.bucket if result.success else None,
        storage_path=result.path if result.success else None,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


async def run_evidence_delivery_workflow(
    db: Session,
    user: User,
    event_id: str,
    storage: SupabaseStorageClient,
    provider_registry: ProviderRegistry,
) -> int:
    """
    The five-minute workflow (Part 14): finalize evidence, generate + upload the PDF, send ONE
    message per active contact with secure links. Idempotent via EmergencyEvent.evidence_delivered_at,
    claimed atomically before any provider call — a retried call is always a safe no-op.
    """
    event = _load_owned_event(db, user.id, event_id)
    if event.evidence_delivered_at is not None:
        return 0  # already delivered once for this incident

    # Atomic claim: an UPDATE with a WHERE on the still-NULL column, read back to confirm we won.
    claimed = (
        db.query(EmergencyEvent)
        .filter(EmergencyEvent.event_id == event.event_id, EmergencyEvent.evidence_delivered_at.is_(None))
        .update({EmergencyEvent.evidence_delivered_at: datetime.now(timezone.utc)})
    )
    db.commit()
    if claimed == 0:
        return 0  # another request already claimed it

    # The delivery claim above is already committed: a PDF-generation exception here must never
    # abort delivery entirely (trusted contacts still need the audio link, and the claim can
    # never be retaken to retry later). Only an actual Supabase upload failure is represented in
    # `report.upload_status`; a raised exception (e.g. a ReportLab rendering error) is caught and
    # simply means no report link goes out this time — it never claims success and never blocks
    # the SMS notification loop below.
    report_url = None
    try:
        report = await generate_and_upload_report(db, user, event_id, storage)
        report_url = await storage.create_signed_url(report.storage_path) if report.storage_path else None
    except Exception as exc:
        logger.warning(f"Incident report generation failed for event {event.event_id}: {exc}")

    evidence_items = db.query(EvidenceItem).filter(EvidenceItem.event_id == event.event_id, EvidenceItem.upload_status == EvidenceUploadStatusEnum.UPLOADED).all()
    audio_url = None
    if evidence_items:
        audio_url = await storage.create_signed_url(evidence_items[0].storage_path)

    contacts: List[TrustedContact] = _active_contacts(db, user.id)
    provider = provider_registry.get_provider(CommunicationChannelEnum.SMS)
    notified = 0

    for contact in contacts:
        log = EvidenceDeliveryLog(
            id=uuid.uuid4(),
            event_id=event.event_id,
            contact_id=contact.id,
            channel=CommunicationChannelEnum.SMS,
            status=CommunicationStatusEnum.QUEUED,
        )
        db.add(log)
        db.flush()

        if provider is None:
            log.status = CommunicationStatusEnum.NOT_SENT
            log.failure_reason = REASON_CHANNEL_UNAVAILABLE
            db.commit()
            continue

        at = datetime.now(timezone.utc).astimezone(IST).strftime("%H:%M")
        lines = ["SHEGUARD EMERGENCY EVIDENCE", "", f"User: {user.phone}", f"Time: {at} IST"]
        if report_url:
            lines += ["", "Incident Report:", report_url]
        if audio_url:
            lines += ["", "Voice Evidence:", audio_url]
        message = "\n".join(lines)

        try:
            response = await provider.send_dispatch(log_shim(log.id, event.event_id), contact, message)
        except Exception as exc:
            logger.warning(f"Evidence delivery failed for event {event.event_id}: {exc}")
            log.status = CommunicationStatusEnum.FAILED
            log.failure_reason = REASON_PROVIDER_ERROR
            db.commit()
            continue

        log.status = response.status
        log.provider_message_id = response.provider_message_id
        log.failure_reason = response.failure_reason
        log.is_simulated = getattr(response, "simulated", False)
        db.commit()
        if response.success:
            notified += 1

    return notified
