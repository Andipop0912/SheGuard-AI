import enum
from datetime import datetime, timezone
from sqlalchemy import Column, String, BigInteger, DateTime, ForeignKey, Enum as SQLEnum, JSON
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.db.models.guid import GUID

class EmergencyStateEnum(str, enum.Enum):
    IDLE = 'IDLE'
    TRIGGERED = 'TRIGGERED'
    RESPONDING = 'RESPONDING'
    NOTIFYING = 'NOTIFYING'
    MONITORING = 'MONITORING'
    RESOLVED = 'RESOLVED'
    CANCELLED = 'CANCELLED'

class EmergencyTriggerSourceEnum(str, enum.Enum):
    MANUAL_SOS = 'MANUAL_SOS'
    VOICE = 'VOICE'
    GESTURE = 'GESTURE'
    HARDWARE_BUTTON = 'HARDWARE_BUTTON'
    SYSTEM = 'SYSTEM'

class EmergencyEvent(Base):
    __tablename__ = "emergency_events"

    event_id = Column(String(64), primary_key=True)
    user_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    device_id = Column(String(64), nullable=False)
    trigger_source = Column(SQLEnum(EmergencyTriggerSourceEnum, name="emergency_trigger_source_enum"), nullable=False)
    state = Column(SQLEnum(EmergencyStateEnum, name="emergency_state_enum"), nullable=False, default=EmergencyStateEnum.TRIGGERED)
    client_created_at = Column(BigInteger, nullable=False)
    client_updated_at = Column(BigInteger, nullable=False)
    resolved_at = Column(BigInteger, nullable=True)
    server_received_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    metadata_json = Column(JSON, nullable=True, default=dict)
    # Set exactly once, atomically claimed: idempotency gate for the five-minute evidence-delivery
    # workflow (report + evidence links to trusted contacts). Never cleared.
    evidence_delivered_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    user = relationship("User", back_populates="emergency_events")
    communication_logs = relationship("EmergencyCommunicationLog", back_populates="emergency_event", cascade="all, delete-orphan")
    locations = relationship("EmergencyLocation", back_populates="emergency_event", cascade="all, delete-orphan")

