from typing import Optional, Tuple

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user_and_device, get_db, get_provider_registry_factory
from app.db.models.device import Device
from app.db.models.emergency_event import EmergencyEvent
from app.db.models.evidence import EvidenceItem
from app.db.models.user import User
from app.schemas.evidence import (
    EvidenceDeliveryResponse,
    EvidenceItemDTO,
    IncidentReportResponse,
    SignedUrlResponse,
)
from app.services import evidence_service
from app.services.supabase_storage import SupabaseStorageClient

router = APIRouter(prefix="/evidence", tags=["Evidence"])

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB: generous for a 5-minute AAC recording, bounds abuse.
ALLOWED_MIME_TYPES = {"audio/m4a", "audio/mp4", "audio/aac", "audio/mpeg"}


def _storage() -> SupabaseStorageClient:
    return SupabaseStorageClient()


def _to_dto(item: EvidenceItem) -> EvidenceItemDTO:
    return EvidenceItemDTO(
        evidenceId=item.evidence_id,
        eventId=item.event_id,
        type=item.type,
        durationMs=item.duration_ms,
        uploadStatus=item.upload_status.value,
    )


@router.post("/{event_id}/items", response_model=EvidenceItemDTO, status_code=status.HTTP_201_CREATED)
async def upload_evidence_item(
    event_id: str,
    evidenceId: str = Form(...),
    durationMs: Optional[int] = Form(default=None),
    clientCreatedAt: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    auth_context: Tuple[User, Device] = Depends(get_current_user_and_device),
):
    user, _device = auth_context
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Unsupported evidence file type")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Evidence file too large")

    item = await evidence_service.upload_evidence_item(
        db, user, event_id, evidenceId, data, file.filename or f"{evidenceId}.m4a", file.content_type, durationMs, clientCreatedAt, _storage()
    )
    return _to_dto(item)


@router.get("/{evidence_id}/download", response_model=SignedUrlResponse)
async def download_evidence(
    evidence_id: str,
    db: Session = Depends(get_db),
    auth_context: Tuple[User, Device] = Depends(get_current_user_and_device),
):
    user, _device = auth_context
    url = await evidence_service.get_evidence_download_url(db, user, evidence_id, _storage())
    if not url:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evidence is not available in the cloud yet")
    return SignedUrlResponse(url=url)


@router.post("/{event_id}/report", response_model=IncidentReportResponse, status_code=status.HTTP_201_CREATED)
async def generate_incident_report(
    event_id: str,
    db: Session = Depends(get_db),
    auth_context: Tuple[User, Device] = Depends(get_current_user_and_device),
):
    user, _device = auth_context
    report = await evidence_service.generate_and_upload_report(db, user, event_id, _storage())
    url = await _storage().create_signed_url(report.storage_path) if report.storage_path else None
    return IncidentReportResponse(reportId=report.report_id, url=url)


@router.post("/{event_id}/deliver", response_model=EvidenceDeliveryResponse)
async def deliver_evidence(
    event_id: str,
    db: Session = Depends(get_db),
    auth_context: Tuple[User, Device] = Depends(get_current_user_and_device),
    registry_factory=Depends(get_provider_registry_factory),
):
    """
    Triggered by the client once an open emergency reaches five minutes (Part 14). Idempotent:
    a retried call after the first successful one is always a safe no-op (contactsNotified: 0,
    delivered: false second time).
    """
    user, _device = auth_context
    notified = await evidence_service.run_evidence_delivery_workflow(db, user, event_id, _storage(), registry_factory())
    event = db.query(EmergencyEvent).filter(EmergencyEvent.event_id == event_id, EmergencyEvent.user_id == user.id).first()
    delivered = bool(event and event.evidence_delivered_at is not None)
    return EvidenceDeliveryResponse(delivered=delivered, contactsNotified=notified)
