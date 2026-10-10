import enum
import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, BigInteger, DateTime, Float, Boolean, ForeignKey, Index, Enum as SQLEnum
)
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.db.models.guid import GUID


class EmergencyLocationKindEnum(str, enum.Enum):
    # Best location available when the emergency started (may be a last-known fix).
    SNAPSHOT = 'SNAPSHOT'
    # Periodic fix collected while the emergency stayed open.
    UPDATE = 'UPDATE'


class EmergencyLocation(Base):
    """
    A single device-reported location fix linked to an emergency.

    Coordinates are stored exactly as captured on the device; nothing here is inferred.
    Idempotency key: the client-generated location_id.
    Volume is bounded per emergency (LOCATION_MAX_POINTS_PER_EMERGENCY).
    """
    __tablename__ = "emergency_locations"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    location_id = Column(String(64), nullable=False, unique=True)
    event_id = Column(
        String(64), ForeignKey("emergency_events.event_id", ondelete="CASCADE"), nullable=False
    )
    user_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    device_id = Column(String(64), nullable=False)

    kind = Column(SQLEnum(EmergencyLocationKindEnum, name="emergency_location_kind_enum"), nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    accuracy_m = Column(Float, nullable=True)
    altitude_m = Column(Float, nullable=True)
    speed_mps = Column(Float, nullable=True)
    heading_deg = Column(Float, nullable=True)
    provider = Column(String(20), nullable=False)
    # True when the device reported a cached (last-known) fix rather than a fresh one.
    is_last_known = Column(Boolean, nullable=False, default=False)

    captured_at = Column(BigInteger, nullable=False)  # device epoch ms, like emergency client_* fields
    received_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    emergency_event = relationship("EmergencyEvent", back_populates="locations")

    __table_args__ = (
        Index("ix_emergency_locations_event_captured", "event_id", "captured_at"),
    )
