import logging
import uuid
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models.communication_log import CommunicationChannelEnum, CommunicationStatusEnum
from app.db.models.device import Device
from app.db.models.route_safety import (
    RouteSafetyCommunicationLog,
    RouteSafetySession,
    RouteSafetyStatusEnum,
)
from app.db.models.trusted_contact import TrustedContact
from app.db.models.user import User
from app.schemas.route_safety import (
    CreateRouteSafetySessionRequest,
    EndRouteSafetySessionRequest,
    SyncRouteLocationRequest,
)
from app.services.communication_provider import ProviderRegistry
from app.services.communication_service import _active_contacts
from app.services.route_safety_message_builder import (
    build_route_deviation_message,
    build_route_started_message,
    log_shim,
)

logger = logging.getLogger(__name__)

SESSION_NOT_FOUND = "Route Safety session not found for this account."
ALREADY_ACTIVE = "A Route Safety session is already active for this account."
REASON_CHANNEL_UNAVAILABLE = "channel_not_available"
REASON_PROVIDER_REJECTED = "provider_rejected"
REASON_PROVIDER_ERROR = "provider_error"


def _live_url(settings_live_base_url: str, share_token: str) -> str:
    return f"{settings_live_base_url}/{share_token}"


class RouteSafetyService:
    @staticmethod
    def create_session(
        db: Session, user: User, device: Device, req: CreateRouteSafetySessionRequest
    ) -> RouteSafetySession:
        if req.deviceId != device.device_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Device does not match the authenticated device")

        existing = (
            db.query(RouteSafetySession)
            .filter(RouteSafetySession.user_id == user.id, RouteSafetySession.status == RouteSafetyStatusEnum.ACTIVE)
            .first()
        )
        if existing and existing.session_id != req.sessionId:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=ALREADY_ACTIVE)
        if existing and existing.session_id == req.sessionId:
            return existing  # idempotent retry of the same create call

        session = RouteSafetySession(
            session_id=req.sessionId,
            user_id=user.id,
            device_id=req.deviceId,
            status=RouteSafetyStatusEnum.ACTIVE,
            start_latitude=req.startLocation.latitude,
            start_longitude=req.startLocation.longitude,
            destination_text=req.destinationText,
            destination_latitude=req.destinationLocation.latitude if req.destinationLocation else None,
            destination_longitude=req.destinationLocation.longitude if req.destinationLocation else None,
            route_polyline=[p.model_dump() for p in req.routePolyline],
            route_distance_meters=req.routeDistanceMeters,
            route_duration_seconds=req.routeDurationSeconds,
            current_latitude=req.startLocation.latitude,
            current_longitude=req.startLocation.longitude,
            last_location_at=req.startedAt,
            client_started_at=req.startedAt,
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        return session

    @staticmethod
    def get_owned_session(db: Session, user: User, session_id: str) -> RouteSafetySession:
        session = (
            db.query(RouteSafetySession)
            .filter(RouteSafetySession.session_id == session_id, RouteSafetySession.user_id == user.id)
            .first()
        )
        if not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=SESSION_NOT_FOUND)
        return session

    @staticmethod
    def get_active_session(db: Session, user: User) -> Optional[RouteSafetySession]:
        return (
            db.query(RouteSafetySession)
            .filter(RouteSafetySession.user_id == user.id, RouteSafetySession.status == RouteSafetyStatusEnum.ACTIVE)
            .first()
        )

    @staticmethod
    def sync_location(db: Session, user: User, session_id: str, req: SyncRouteLocationRequest) -> RouteSafetySession:
        session = RouteSafetyService.get_owned_session(db, user, session_id)
        if session.status == RouteSafetyStatusEnum.ACTIVE:
            # Out-of-order updates (slow network) must never overwrite a newer position.
            if session.last_location_at is None or req.timestamp >= session.last_location_at:
                session.current_latitude = req.latitude
                session.current_longitude = req.longitude
                session.last_location_at = req.timestamp
                db.commit()
                db.refresh(session)
        return session

    @staticmethod
    def end_session(db: Session, user: User, session_id: str, req: EndRouteSafetySessionRequest) -> RouteSafetySession:
        from datetime import datetime, timezone

        session = RouteSafetyService.get_owned_session(db, user, session_id)
        if session.status == RouteSafetyStatusEnum.ACTIVE:
            session.status = req.status.value
            session.ended_at = datetime.now(timezone.utc)
            db.commit()
            db.refresh(session)
        return session

    @staticmethod
    async def notify_started(
        db: Session, user: User, session_id: str, provider_registry: ProviderRegistry, live_base_url: str
    ) -> int:
        session = RouteSafetyService.get_owned_session(db, user, session_id)
        return await RouteSafetyService._dispatch(db, user, session, "STARTED", provider_registry, live_base_url)

    @staticmethod
    async def notify_deviation(
        db: Session, user: User, session_id: str, provider_registry: ProviderRegistry, live_base_url: str
    ) -> int:
        session = RouteSafetyService.get_owned_session(db, user, session_id)
        return await RouteSafetyService._dispatch(db, user, session, "DEVIATION", provider_registry, live_base_url)

    @staticmethod
    async def _dispatch(
        db: Session,
        user: User,
        session: RouteSafetySession,
        kind: str,
        provider_registry: ProviderRegistry,
        live_base_url: str,
    ) -> int:
        """One message per active contact, per (session, kind) — the unique constraint makes a
        duplicate call for the same kind a safe no-op (Part 9/15/21 idempotency)."""
        contacts: List[TrustedContact] = _active_contacts(db, user.id)
        live_url = _live_url(live_base_url, session.share_token)
        sent = 0

        provider = provider_registry.get_provider(CommunicationChannelEnum.SMS)
        for contact in contacts:
            log = RouteSafetyCommunicationLog(
                id=uuid.uuid4(),
                session_id=session.session_id,
                contact_id=contact.id,
                channel=CommunicationChannelEnum.SMS,
                kind=kind,
                status=CommunicationStatusEnum.QUEUED,
            )
            try:
                db.add(log)
                db.flush()  # triggers the unique constraint now, before any provider call
            except IntegrityError:
                db.rollback()
                continue  # already sent for this contact/kind — never a duplicate send

            if provider is None:
                log.status = CommunicationStatusEnum.NOT_SENT
                log.failure_reason = REASON_CHANNEL_UNAVAILABLE
                db.commit()
                continue

            message = (
                build_route_started_message(session, user, live_url)
                if kind == "STARTED"
                else build_route_deviation_message(session, live_url)
            )
            try:
                response = await provider.send_dispatch(log_shim(log.id, session.session_id), contact, message)
            except Exception as exc:  # provider failures must never break Route Safety itself
                logger.warning(f"Route Safety dispatch failed for session {session.session_id}: {exc}")
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
                sent += 1

        return sent
