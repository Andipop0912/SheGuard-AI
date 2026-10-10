from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Optional

from app.db.models.route_safety import RouteSafetySession
from app.db.models.user import User
from app.services.message_builder import google_maps_url

IST = timezone(timedelta(hours=5, minutes=30), name="IST")


def _live_location_line(session: RouteSafetySession, live_url: str) -> str:
    return f"Live Location: {live_url}"


def build_route_started_message(session: RouteSafetySession, user: User, live_url: str) -> str:
    start_url = google_maps_url(session.start_latitude, session.start_longitude)
    lines = [
        "SHEGUARD ROUTE SAFETY STARTED",
        f"User: {user.phone}",
        f"Destination: {session.destination_text}",
    ]
    if start_url:
        lines.append(f"Start: {start_url}")
    lines.append(_live_location_line(session, live_url))
    lines.append("Route Safety: ACTIVE")
    return "\n".join(lines)


def build_route_deviation_message(session: RouteSafetySession, live_url: str) -> str:
    at = datetime.now(timezone.utc).astimezone(IST).strftime("%H:%M")
    lines = ["⚠️ SHEGUARD ROUTE DEVIATION", "", "The user appears to have moved away from the planned Route Safety path."]
    lines.append(f"Destination: {session.destination_text}")
    current_url = (
        google_maps_url(session.current_latitude, session.current_longitude)
        if session.current_latitude is not None and session.current_longitude is not None
        else None
    )
    if current_url:
        lines.append(f"Current Location: {current_url}")
    lines.append("Current Status: Deviation Confirmed")
    lines.append(f"Time: {at} IST")
    lines.append(_live_location_line(session, live_url))
    return "\n".join(lines)


def log_shim(log_id, session_id) -> SimpleNamespace:
    """
    CommunicationProvider.send_dispatch() only logs `log.id` / `log.event_id` — it never persists
    through this object. RouteSafetyCommunicationLog has no `event_id`, so this tiny shim supplies
    what the provider's logging line expects without changing the provider for a second log shape.
    """
    return SimpleNamespace(id=log_id, event_id=session_id)
