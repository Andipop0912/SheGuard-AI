import uuid
from datetime import datetime, timezone
from typing import List, Optional
from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from app.core.config import settings
from app.db.models.trusted_contact import TrustedContact
from app.schemas.contact import TrustedContactCreate, TrustedContactUpdate


def _live_contacts(db: Session, user_id: uuid.UUID):
    """Contacts that exist for the user. Soft-deleted rows are kept only as history."""
    return db.query(TrustedContact).filter(TrustedContact.user_id == user_id, TrustedContact.deleted_at.is_(None))


def _ensure_unique_phone(db: Session, user_id: uuid.UUID, phone: str, exclude_id: Optional[uuid.UUID] = None) -> None:
    query = _live_contacts(db, user_id).filter(TrustedContact.phone == phone)
    if exclude_id is not None:
        query = query.filter(TrustedContact.id != exclude_id)
    if query.first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This number is already one of your trusted contacts.",
        )


def _ensure_active_capacity(db: Session, user_id: uuid.UUID, exclude_id: Optional[uuid.UUID] = None) -> None:
    query = _live_contacts(db, user_id).filter(TrustedContact.is_active == True)
    if exclude_id is not None:
        query = query.filter(TrustedContact.id != exclude_id)
    if query.count() >= settings.MAX_ACTIVE_TRUSTED_CONTACTS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"You can have at most {settings.MAX_ACTIVE_TRUSTED_CONTACTS} active trusted contacts. "
                "Deactivate one first."
            ),
        )


def create_contact(db: Session, user_id: uuid.UUID, contact_in: TrustedContactCreate) -> TrustedContact:
    if _live_contacts(db, user_id).count() >= settings.MAX_TRUSTED_CONTACTS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"You can have at most {settings.MAX_TRUSTED_CONTACTS} trusted contacts. Remove one first.",
        )
    _ensure_unique_phone(db, user_id, contact_in.phone)
    if contact_in.is_active:
        _ensure_active_capacity(db, user_id)

    contact = TrustedContact(
        user_id=user_id,
        name=contact_in.name,
        phone=contact_in.phone,
        relationship=contact_in.relationship,
        priority=contact_in.priority,
        is_active=contact_in.is_active,
    )
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact

def get_user_contacts(db: Session, user_id: uuid.UUID, include_inactive: bool = False) -> List[TrustedContact]:
    query = _live_contacts(db, user_id)
    if not include_inactive:
        query = query.filter(TrustedContact.is_active == True)
    return query.order_by(TrustedContact.priority.asc(), TrustedContact.created_at.asc()).all()

def get_contact_by_id(db: Session, contact_id: uuid.UUID, user_id: uuid.UUID) -> TrustedContact:
    contact = _live_contacts(db, user_id).filter(TrustedContact.id == contact_id).first()
    if not contact:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trusted contact not found or does not belong to user",
        )
    return contact

def update_contact(db: Session, contact_id: uuid.UUID, user_id: uuid.UUID, contact_in: TrustedContactUpdate) -> TrustedContact:
    contact = get_contact_by_id(db, contact_id, user_id)

    update_data = contact_in.model_dump(exclude_unset=True)
    if update_data.get("phone") is not None and update_data["phone"] != contact.phone:
        _ensure_unique_phone(db, user_id, update_data["phone"], exclude_id=contact.id)
    if update_data.get("is_active") is True and not contact.is_active:
        _ensure_active_capacity(db, user_id, exclude_id=contact.id)

    for field, value in update_data.items():
        if value is None and field in ("name", "phone", "priority", "is_active"):
            continue  # required columns: an explicit null leaves the stored value unchanged
        setattr(contact, field, value)

    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact

def delete_contact(db: Session, contact_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Soft delete: the contact never receives alerts again; its communication history is kept."""
    contact = get_contact_by_id(db, contact_id, user_id)
    contact.is_active = False
    contact.deleted_at = datetime.now(timezone.utc)
    db.add(contact)
    db.commit()
