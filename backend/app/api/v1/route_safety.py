from typing import Optional, Tuple

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.dependencies import (
    get_current_user_and_device,
    get_db,
    get_dispatch_session_scope,
    get_provider_registry_factory,
)
from app.db.models.device import Device
from app.db.models.route_safety import RouteSafetySession, RouteSafetyStatusEnum
from app.db.models.user import User
from app.schemas.route_safety import (
    CreateRouteSafetySessionRequest,
    EndRouteSafetySessionRequest,
    LiveLocationPublicDTO,
    RoutePointDTO,
    RouteSafetySessionDTO,
    SyncRouteLocationRequest,
)
from app.services.route_safety_service import RouteSafetyService

router = APIRouter(prefix="/route-safety", tags=["Route Safety"])


def _to_dto(session: RouteSafetySession) -> RouteSafetySessionDTO:
    return RouteSafetySessionDTO(
        sessionId=session.session_id,
        userId=str(session.user_id),
        deviceId=session.device_id,
        status=session.status,
        startLocation=RoutePointDTO(latitude=session.start_latitude, longitude=session.start_longitude),
        destinationText=session.destination_text,
        destinationLocation=(
            RoutePointDTO(latitude=session.destination_latitude, longitude=session.destination_longitude)
            if session.destination_latitude is not None and session.destination_longitude is not None
            else None
        ),
        routePolyline=[RoutePointDTO(**p) for p in (session.route_polyline or [])],
        routeDistanceMeters=session.route_distance_meters,
        routeDurationSeconds=session.route_duration_seconds,
        currentLocation=(
            RoutePointDTO(latitude=session.current_latitude, longitude=session.current_longitude)
            if session.current_latitude is not None and session.current_longitude is not None
            else None
        ),
        lastLocationAt=session.last_location_at,
        deviationState=session.deviation_state,
        startedAt=session.client_started_at,
        endedAt=session.ended_at.isoformat() if session.ended_at else None,
    )


@router.post("", response_model=RouteSafetySessionDTO, status_code=status.HTTP_201_CREATED)
def create_route_safety_session(
    req: CreateRouteSafetySessionRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    auth_context: Tuple[User, Device] = Depends(get_current_user_and_device),
    session_scope=Depends(get_dispatch_session_scope),
    registry_factory=Depends(get_provider_registry_factory),
):
    user, device = auth_context
    session = RouteSafetyService.create_session(db, user, device, req)

    # Immediate notification (Part 9) — runs after the response, never blocks session creation.
    background_tasks.add_task(
        _dispatch_started_background, session_scope, registry_factory, user.id, session.session_id
    )
    return _to_dto(session)


def _dispatch_started_background(session_scope, registry_factory, user_id, session_id: str):
    import asyncio

    with session_scope() as db:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            return
        asyncio.run(
            RouteSafetyService.notify_started(
                db, user, session_id, registry_factory(), settings.ROUTE_SAFETY_LIVE_BASE_URL
            )
        )


@router.get("/active", response_model=Optional[RouteSafetySessionDTO])
def get_active_route_safety_session(
    db: Session = Depends(get_db),
    auth_context: Tuple[User, Device] = Depends(get_current_user_and_device),
):
    user, _device = auth_context
    session = RouteSafetyService.get_active_session(db, user)
    return _to_dto(session) if session else None


@router.post("/{session_id}/location", response_model=RouteSafetySessionDTO)
def sync_route_location(
    session_id: str,
    req: SyncRouteLocationRequest,
    db: Session = Depends(get_db),
    auth_context: Tuple[User, Device] = Depends(get_current_user_and_device),
):
    user, _device = auth_context
    session = RouteSafetyService.sync_location(db, user, session_id, req)
    return _to_dto(session)


@router.post("/{session_id}/deviation", status_code=status.HTTP_202_ACCEPTED)
def record_route_deviation(
    session_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    auth_context: Tuple[User, Device] = Depends(get_current_user_and_device),
    session_scope=Depends(get_dispatch_session_scope),
    registry_factory=Depends(get_provider_registry_factory),
):
    """
    The client's own local RouteDeviationDetector already confirmed the deviation (Part 2: that
    calculation stays local); this just records it and triggers one alert per active contact.
    The (session, contact, channel, kind) unique constraint makes a retried call a safe no-op.
    """
    user, _device = auth_context
    # 404s if the session doesn't belong to this user — fail fast before queuing background work.
    RouteSafetyService.get_owned_session(db, user, session_id)
    background_tasks.add_task(
        _dispatch_deviation_background, session_scope, registry_factory, user.id, session_id
    )
    return {"accepted": True}


def _dispatch_deviation_background(session_scope, registry_factory, user_id, session_id: str):
    import asyncio

    with session_scope() as db:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            return
        asyncio.run(
            RouteSafetyService.notify_deviation(
                db, user, session_id, registry_factory(), settings.ROUTE_SAFETY_LIVE_BASE_URL
            )
        )


@router.post("/{session_id}/end", response_model=RouteSafetySessionDTO)
def end_route_safety_session(
    session_id: str,
    req: EndRouteSafetySessionRequest = EndRouteSafetySessionRequest(),
    db: Session = Depends(get_db),
    auth_context: Tuple[User, Device] = Depends(get_current_user_and_device),
):
    user, _device = auth_context
    session = RouteSafetyService.end_session(db, user, session_id, req)
    return _to_dto(session)


@router.get("/live/{share_token}", response_model=LiveLocationPublicDTO)
def get_live_location(share_token: str, db: Session = Depends(get_db)):
    """
    Unauthenticated by design (this is the link sent by SMS to a trusted contact, who is not a
    SheGuard account holder) but scoped to exactly one session via an unguessable token — never
    the raw session id, never any other user/device identifier.
    """
    session = db.query(RouteSafetySession).filter(RouteSafetySession.share_token == share_token).first()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Live location link not found")
    return LiveLocationPublicDTO(
        status=session.status,
        destinationText=session.destination_text,
        currentLocation=(
            RoutePointDTO(latitude=session.current_latitude, longitude=session.current_longitude)
            if session.current_latitude is not None and session.current_longitude is not None
            else None
        ),
        lastLocationAt=session.last_location_at,
        deviationState=session.deviation_state,
    )
