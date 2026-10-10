import enum
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, Enum as SQLEnum, UniqueConstraint
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.db.models.guid import GUID

class CommunicationChannelEnum(str, enum.Enum):
    SMS = "SMS"
    FCM = "FCM"
    VOICE_CALL = "VOICE_CALL"

class CommunicationStatusEnum(str, enum.Enum):
    QUEUED = "QUEUED"
    # Claimed by a dispatch run; a provider attempt is in progress.
    DISPATCHED = "DISPATCHED"
    # The provider explicitly accepted the request. NOT delivery.
    PROVIDER_ACCEPTED = "PROVIDER_ACCEPTED"
    # Only with real provider delivery evidence (no current provider supplies it).
    DELIVERED = "DELIVERED"
    # The provider explicitly rejected the request, or sending failed definitively.
    FAILED = "FAILED"
    # The system deliberately did not send (emergency already closed, channel unavailable, ...).
    NOT_SENT = "NOT_SENT"
    # The final attempt got no provider answer (timeout): it may or may not have been sent.
    UNCERTAIN = "UNCERTAIN"

class EmergencyCommunicationLog(Base):
    __tablename__ = "emergency_communication_logs"
    __table_args__ = (
        UniqueConstraint("event_id", "contact_id", "channel", name="uq_event_contact_channel"),
    )

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    event_id = Column(String(64), ForeignKey("emergency_events.event_id", ondelete="CASCADE"), nullable=False, index=True)
    contact_id = Column(GUID, ForeignKey("trusted_contacts.id", ondelete="CASCADE"), nullable=False, index=True)
    channel = Column(SQLEnum(CommunicationChannelEnum, name="communication_channel_enum"), nullable=False)
    status = Column(SQLEnum(CommunicationStatusEnum, name="communication_status_enum"), nullable=False, default=CommunicationStatusEnum.QUEUED)
    provider_message_id = Column(String(255), nullable=True)
    attempted_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    provider_accepted_at = Column(DateTime(timezone=True), nullable=True)
    delivered_at = Column(DateTime(timezone=True), nullable=True)
    failed_at = Column(DateTime(timezone=True), nullable=True)
    failure_reason = Column(String(500), nullable=True)
    # Machine-readable reason for NOT_SENT / FAILED / UNCERTAIN (e.g. emergency_already_resolved).
    reason_code = Column(String(64), nullable=True)
    # Total provider calls made for this record, across every dispatch run (bounded).
    attempt_count = Column(Integer, nullable=False, default=0)
    # True when the provider was the development simulator: nothing was really sent.
    is_simulated = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    emergency_event = relationship("EmergencyEvent", back_populates="communication_logs")
    contact = relationship("TrustedContact", back_populates="communication_logs")
