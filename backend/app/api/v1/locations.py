from typing import Tuple
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session
from app.core.dependencies import get_db, get_current_user, get_current_user_and_device
from app.db.models.device import Device
from app.db.models.user import User
from app.schemas.location import LocationBatchSyncRequest, LocationBatchSyncResponse, LocationPointResponse
from app.services.location_service import LocationService

router = APIRouter(prefix="/emergencies", tags=["Emergency Location"])


@router.post(
    "/{event_id}/locations/sync",
    response_model=LocationBatchSyncResponse,
    status_code=status.HTTP_200_OK,
    summary="Idempotently upload location fixes captured on the device for an emergency",
)
def sync_emergency_locations(
    event_id: str,
    req: LocationBatchSyncRequest,
    db: Session = Depends(get_db),
    auth_context: Tuple[User, Device] = Depends(get_current_user_and_device),
):
    user, device = auth_context
    return LocationService.sync_points(db, user, device, event_id, req)


@router.get(
    "/{event_id}/locations/latest",
    response_model=LocationPointResponse,
    summary="Most recent location fix recorded for an emergency owned by the user",
)
def latest_emergency_location(
    event_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return LocationService.latest_point(db, current_user, event_id)
