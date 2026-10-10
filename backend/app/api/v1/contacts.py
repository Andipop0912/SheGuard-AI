import uuid
from typing import List
from fastapi import APIRouter, Depends, status, Query
from sqlalchemy.orm import Session
from app.core.dependencies import get_current_user, get_db
from app.db.models.user import User
from app.schemas.contact import (
    TrustedContactCreate,
    TrustedContactUpdate,
    TrustedContactDTO,
)
from app.services import contact_service

router = APIRouter(prefix="/contacts", tags=["Trusted Contacts"])

@router.post("", response_model=TrustedContactDTO, status_code=status.HTTP_201_CREATED)
def create_trusted_contact(
    contact_in: TrustedContactCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new trusted contact for the authenticated user."""
    return contact_service.create_contact(db, current_user.id, contact_in)

@router.get("", response_model=List[TrustedContactDTO])
def list_trusted_contacts(
    include_inactive: bool = Query(False, description="Whether to include inactive contacts"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all trusted contacts belonging to the authenticated user."""
    return contact_service.get_user_contacts(db, current_user.id, include_inactive=include_inactive)

@router.get("/{contact_id}", response_model=TrustedContactDTO)
def get_trusted_contact(
    contact_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retrieve a specific trusted contact by ID (user-bound)."""
    return contact_service.get_contact_by_id(db, contact_id, current_user.id)

@router.patch("/{contact_id}", response_model=TrustedContactDTO)
def update_trusted_contact(
    contact_id: uuid.UUID,
    contact_in: TrustedContactUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a trusted contact (user-bound)."""
    return contact_service.update_contact(db, contact_id, current_user.id, contact_in)

@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trusted_contact(
    contact_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a trusted contact (user-bound)."""
    contact_service.delete_contact(db, contact_id, current_user.id)
    return None
