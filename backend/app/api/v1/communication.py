from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.core.dependencies import get_current_user, get_db
from app.db.models.user import User
from app.schemas.communication import CommunicationLogDTO
from app.services import communication_service

# Communication records are created ONLY by the server's dispatch engine. There is deliberately no
# client endpoint to create or modify them (Phase 3D, D10).
router = APIRouter(prefix="/emergency/communication", tags=["Emergency Communication Logs"])

@router.get("/logs/{event_id}", response_model=List[CommunicationLogDTO])
def list_event_communication_logs(
    event_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Communication records for one of the user's emergencies, with a snapshot of each contact
    (including contacts removed later, kept as history).
    """
    return communication_service.get_event_communication_logs(
        db=db,
        user_id=current_user.id,
        event_id=event_id,
    )
