import enum
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, BigInteger, Boolean, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.db.models.guid import GUID
from app.db.models.communication_log import CommunicationChannelEnum, CommunicationStatusEnum


class EvidenceUploadStatusEnum(str, enum.Enum):
    PENDING = "PENDING"
    UPLOADED = "UPLOADED"
    FAILED = "FAILED"


class EvidenceItem(Base):
    """
    Metadata only — the actual audio binary lives in Supabase Storage, never in Postgres.
    evidence_id is the client-generated id (ev-<ts>-<rand>), kept as the primary key so re-syncing
    the same evidence item is naturally idempotent (upsert by primary key).
    """

    __tablename__ = "evidence_items"

    evidence_id = Column(String(64), primary_key=True)
    event_id = Column(String(64), ForeignKey("emergency_events.event_id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String(16), nullable=False, default="AUDIO")
    file_name = Column(String(255), nullable=False)
    mime_type = Column(String(64), nullable=False)
    storage_bucket = Column(String(128), nullable=True)
    storage_path = Column(String(512), nullable=True)
    size_bytes = Column(BigInteger, nullable=True)
    duration_ms = Column(BigInteger, nullable=True)
    checksum = Column(String(128), nullable=True)
    upload_status = Column(SQLEnum(EvidenceUploadStatusEnum, name="evidence_upload_status_enum"), nullable=False, default=EvidenceUploadStatusEnum.PENDING)
    upload_error = Column(String(500), nullable=True)
    client_created_at = Column(BigInteger, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False
    )

    emergency_event = relationship("EmergencyEvent")


class IncidentReport(Base):
    """One generated PDF report per incident. Metadata only; the PDF itself lives in Supabase."""

    __tablename__ = "incident_reports"

    report_id = Column(String(64), primary_key=True)
    event_id = Column(String(64), ForeignKey("emergency_events.event_id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    storage_bucket = Column(String(128), nullable=True)
    storage_path = Column(String(512), nullable=True)
    size_bytes = Column(BigInteger, nullable=True)
    upload_status = Column(SQLEnum(EvidenceUploadStatusEnum, name="evidence_upload_status_enum"), nullable=False, default=EvidenceUploadStatusEnum.PENDING)
    upload_error = Column(String(500), nullable=True)
    generated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    emergency_event = relationship("EmergencyEvent")


class EvidenceDeliveryLog(Base):
    """One row per contact for the one-time, five-minute evidence-delivery workflow."""

    __tablename__ = "evidence_delivery_logs"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    event_id = Column(String(64), ForeignKey("emergency_events.event_id", ondelete="CASCADE"), nullable=False, index=True)
    contact_id = Column(GUID, ForeignKey("trusted_contacts.id", ondelete="CASCADE"), nullable=False)
    channel = Column(SQLEnum(CommunicationChannelEnum, name="communication_channel_enum"), nullable=False)
    status = Column(SQLEnum(CommunicationStatusEnum, name="communication_status_enum"), nullable=False)
    provider_message_id = Column(String(255), nullable=True)
    failure_reason = Column(String(500), nullable=True)
    is_simulated = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
