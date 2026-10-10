import math
from dataclasses import dataclass
from urllib.parse import quote
from datetime import datetime, timedelta, timezone
from typing import Optional, Protocol

from sqlalchemy.orm import Session

from app.db.models.communication_log import CommunicationChannelEnum
from app.db.models.emergency_event import EmergencyEvent
from app.db.models.emergency_location import EmergencyLocation
from app.db.models.trusted_contact import TrustedContact
from app.db.models.user import User

IST = timezone(timedelta(hours=5, minutes=30), name="IST")

TRIGGER_LABELS = {
    "MANUAL_SOS": "Manual SOS",
    "VOICE": "Voice",
    "GESTURE": "Shake",
    "HARDWARE_BUTTON": "Hardware button",
    "SYSTEM": "System",
}

# A device clock further ahead than this (vs. server receipt) is not trusted for the alert time.
MAX_FUTURE_SKEW = timedelta(minutes=5)


@dataclass(frozen=True)
class MessageLocation:
    """A location the SERVER holds for the emergency (never text supplied by the app)."""
    latitude: float
    longitude: float
    accuracy_m: Optional[float]
    captured_at_ms: int


class LocationRenderer(Protocol):
    """Turns a stored location into the SMS location line. Phase 3E plugs in a map-link renderer."""

    def render(self, location: MessageLocation) -> Optional[str]:
        ...


GOOGLE_MAPS_SEARCH_URL = "https://www.google.com/maps/search/?api=1&query="
# 5 decimal places ≈ 1.1 m: finer than any phone fix, short enough for an SMS.
MAP_LINK_DECIMALS = 5


def google_maps_url(latitude: float, longitude: float) -> Optional[str]:
    """
    Google Maps link to one point (no API key needed or included). Returns None for anything that is
    not a real coordinate, so a broken location never produces a misleading link.
    """
    try:
        lat = float(latitude)
        lon = float(longitude)
    except (TypeError, ValueError):
        return None
    if not (math.isfinite(lat) and math.isfinite(lon)) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    query = quote(f"{lat:.{MAP_LINK_DECIMALS}f},{lon:.{MAP_LINK_DECIMALS}f}", safe="")
    return f"{GOOGLE_MAPS_SEARCH_URL}{query}"


class GoogleMapsLinkRenderer:
    """
    Phase 3E: the latest server-stored emergency location as a Google Maps link.
    This is the LATEST KNOWN location when the alert was built, not a live-tracking link.
    """

    def render(self, location: MessageLocation) -> Optional[str]:
        url = google_maps_url(location.latitude, location.longitude)
        return f"Location: {url}" if url else None


def latest_stored_location(db: Session, event_id: str) -> Optional[MessageLocation]:
    point = (
        db.query(EmergencyLocation)
        .filter(EmergencyLocation.event_id == event_id)
        .order_by(EmergencyLocation.captured_at.desc())
        .first()
    )
    if point is None:
        return None
    return MessageLocation(
        latitude=point.latitude,
        longitude=point.longitude,
        accuracy_m=point.accuracy_m,
        captured_at_ms=point.captured_at,
    )


def emergency_time(event: EmergencyEvent) -> datetime:
    """When the emergency was triggered (stored server-side), guarded against a skewed device clock."""
    received = event.server_received_at
    if received is not None and received.tzinfo is None:
        received = received.replace(tzinfo=timezone.utc)
    triggered = datetime.fromtimestamp(event.client_created_at / 1000, tz=timezone.utc)
    if received is not None and triggered > received + MAX_FUTURE_SKEW:
        return received
    return triggered


class EmergencyMessageBuilder:
    """
    Builds the alert text on the server. The app can never supply message text or location text.

    SMS template (Phase 3E):
        SheGuard ALERT: <user phone> triggered an emergency (<trigger>) at <HH:MM> IST.
        Location: https://www.google.com/maps/search/?api=1&query=<lat>%2C<lng>
                                         <- only when the server holds a valid location for it
        Please check on them.
    """

    location_renderer: LocationRenderer = GoogleMapsLinkRenderer()

    @classmethod
    def build_emergency_message(
        cls,
        event: EmergencyEvent,
        user: User,
        contact: TrustedContact,
        channel: CommunicationChannelEnum,
        location: Optional[MessageLocation] = None,
    ) -> str:
        trigger = TRIGGER_LABELS.get(event.trigger_source.value, event.trigger_source.value)
        at = emergency_time(event).astimezone(IST).strftime("%H:%M")
        lines = [f"SheGuard ALERT: {user.phone} triggered an emergency ({trigger}) at {at} IST."]

        location_line = cls.location_renderer.render(location) if location is not None else None
        if location_line:
            lines.append(location_line)

        lines.append("Please check on them.")
        return "\n".join(lines)
