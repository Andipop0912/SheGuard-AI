import enum
import secrets
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Float, Boolean, BigInteger, DateTime, ForeignKey, Enum as SQLEnum, JSON, UniqueConstraint
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.db.models.guid import GUID
from app.db.models.communication_log import CommunicationChannelEnum, CommunicationStatusEnum


class RouteSafetyStatusEnum(str, enum.Enum):
    ACTIVE = "ACTIVE"
    ENDED = "ENDED"
    CANCELLED = "CANCELLED"


class RouteDeviationStateEnum(str, enum.Enum):
    ON_ROUTE = "ON_ROUTE"
    POSSIBLE_DEVIATION = "POSSIBLE_DEVIATION"
    DEROUTED = "DEROUTED"
    RETURNED_TO_ROUTE = "RETURNED_TO_ROUTE"


def generate_share_token() -> str:
    """Opaque, unguessable token for the unauthenticated live-location link sent by SMS."""
    return secrets.token_urlsafe(24)


class RouteSafetySession(Base):
    __tablename__ = "route_safety_sessions"

    session_id = Column(String(64), primary_key=True)
    user_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    device_id = Column(String(64), nullable=False)
    status = Column(SQLEnum(RouteSafetyStatusEnum, name="route_safety_status_enum"), nullable=False, default=RouteSafetyStatusEnum.ACTIVE)

    start_latitude = Column(Float, nullable=False)
    start_longitude = Column(Float, nullable=False)
    destination_text = Column(String(500), nullable=False)
    destination_latitude = Column(Float, nullable=True)
    destination_longitude = Column(Float, nullable=True)

    # List of {"latitude": float, "longitude": float} — the original, authoritative route.
    route_polyline = Column(JSON, nullable=True)
    route_distance_meters = Column(Float, nullable=True)
    route_duration_seconds = Column(Integer, nullable=True)

    current_latitude = Column(Float, nullable=True)
    current_longitude = Column(Float, nullable=True)
    # Client epoch ms of the most recent location update (device clock, like EmergencyEvent).
    last_location_at = Column(BigInteger, nullable=True)

    deviation_state = Column(
        SQLEnum(RouteDeviationStateEnum, name="route_deviation_state_enum"),
        nullable=False,
        default=RouteDeviationStateEnum.ON_ROUTE,
    )
    deviation_state_since = Column(BigInteger, nullable=True)
    deviation_alert_sent_at = Column(BigInteger, nullable=True)

    # Unauthenticated, unguessable reference used by the SMS live-location link. Never the raw
    # session_id (which would otherwise let a guessed/enumerated id probe another user's route).
    share_token = Column(String(64), nullable=False, unique=True, default=generate_share_token, index=True)

    client_started_at = Column(BigInteger, nullable=False)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user = relationship("User")
    communication_logs = relationship(
        "RouteSafetyCommunicationLog", back_populates="route_safety_session", cascade="all, delete-orphan"
    )


class RouteSafetyCommunicationLog(Base):
    """
    Mirrors EmergencyCommunicationLog's shape deliberately (reuses the same channel/status enum
    types) rather than inventing a parallel communication model — Route Safety still goes through
    the one existing provider registry / Fast2SMS integration.
    """

    __tablename__ = "route_safety_communication_logs"
    __table_args__ = (
        UniqueConstraint("session_id", "contact_id", "channel", "kind", name="uq_route_safety_session_contact_channel_kind"),
    )

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    session_id = Column(String(64), ForeignKey("route_safety_sessions.session_id", ondelete="CASCADE"), nullable=False, index=True)
    contact_id = Column(GUID, ForeignKey("trusted_contacts.id", ondelete="CASCADE"), nullable=False, index=True)
    channel = Column(SQLEnum(CommunicationChannelEnum, name="communication_channel_enum"), nullable=False)
    # "STARTED" (Part 9) or "DEVIATION" (Part 15). Not an enum: this table only ever needs these
    # two kinds today and a plain string avoids a third migration-managed Postgres enum type.
    kind = Column(String(32), nullable=False)
    status = Column(SQLEnum(CommunicationStatusEnum, name="communication_status_enum"), nullable=False)
    provider_message_id = Column(String(255), nullable=True)
    failure_reason = Column(String(500), nullable=True)
    is_simulated = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    route_safety_session = relationship("RouteSafetySession", back_populates="communication_logs")
    contact = relationship("TrustedContact")
