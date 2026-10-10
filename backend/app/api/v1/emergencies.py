from typing import Tuple
from fastapi import APIRouter, BackgroundTasks, Depends, status
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.dependencies import (
    get_db,
    get_current_user_and_device,
    get_dispatch_session_scope,
    get_provider_registry_factory,
)
from app.db.models.user import User
from app.db.models.device import Device
from app.schemas.emergency import EmergencyBatchSyncRequest, EmergencyBatchSyncResponse, SyncItemResultStatus, EmergencyEventDTO
from app.schemas.communication import EmergencyDispatchSummary
from typing import List
from app.services.emergency_service import EmergencyService
from app.services import communication_service

router = APIRouter(prefix="/emergencies", tags=["Emergency Synchronization & Dispatch"])

@router.post(
    "/sync",
    response_model=EmergencyBatchSyncResponse,
    status_code=status.HTTP_200_OK,
    summary="Batch synchronize offline emergency events idempotently"
)
def sync_emergencies(
    req: EmergencyBatchSyncRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    auth_context: Tuple[User, Device] = Depends(get_current_user_and_device),
    session_scope=Depends(get_dispatch_session_scope),
    registry_factory=Depends(get_provider_registry_factory),
):
    user, device = auth_context
    response = EmergencyService.sync_batch_events(db, user, device, req)

    # Communication is server-owned and runs AFTER the sync response, in the background.
    # SYNCED = first arrival (open → alert contacts; already closed → NOT_SENT records).
    # UPDATED = lifecycle change (e.g. resolved → stop unsent alerts). Idempotent and bounded.
    if settings.AUTO_DISPATCH_ON_SYNC:
        for result in response.results:
            if result.status in (SyncItemResultStatus.SYNCED, SyncItemResultStatus.UPDATED):
                background_tasks.add_task(
                    communication_service.run_dispatch_after_sync,
                    session_scope,
                    registry_factory,
                    user.id,
                    result.eventId,
                    result.status == SyncItemResultStatus.SYNCED,
                )
    return response

@router.post(
    "/{event_id}/dispatch",
    response_model=EmergencyDispatchSummary,
    status_code=status.HTTP_200_OK,
    summary="Re-run the server's alert dispatch for an emergency (idempotent; no client options)"
)
async def dispatch_emergency(
    event_id: str,
    db: Session = Depends(get_db),
    auth_context: Tuple[User, Device] = Depends(get_current_user_and_device),
    registry_factory=Depends(get_provider_registry_factory),
):
    """
    Runs the same server-owned engine as automatic dispatch. The client cannot choose contacts,
    channels, phone numbers or message text. Already accepted or final records are never re-sent.
    """
    user, _device = auth_context
    return await communication_service.dispatch_emergency_communications(
        db=db,
        user_id=user.id,
        event_id=event_id,
        provider_registry=registry_factory(),
    )

@router.get(
    "/",
    response_model=List[EmergencyEventDTO],
    status_code=status.HTTP_200_OK,
    summary="Get user's historical emergencies"
)
def get_historical_emergencies(
    db: Session = Depends(get_db),
    auth_context: Tuple[User, Device] = Depends(get_current_user_and_device),
):
    user, _device = auth_context
    return EmergencyService.get_user_events(db, user.id)
