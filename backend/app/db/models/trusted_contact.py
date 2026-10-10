import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, Index, text
from sqlalchemy.orm import relationship as sqlalchemy_relationship
from app.db.base import Base
from app.db.models.guid import GUID

class TrustedContact(Base):
    __tablename__ = "trusted_contacts"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    user_id = Column(GUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    phone = Column(String(20), nullable=False, index=True)
    relationship = Column(String(50), nullable=True)
    priority = Column(Integer, default=1, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)
    # Soft delete: the row (and its communication history) is kept; it never receives alerts again.
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    user = sqlalchemy_relationship("User", back_populates="trusted_contacts")
    communication_logs = sqlalchemy_relationship("EmergencyCommunicationLog", back_populates="contact", cascade="all, delete-orphan")

    __table_args__ = (
        # One live (not deleted) contact per normalized number per user.
        Index(
            "uq_trusted_contacts_user_phone_live",
            "user_id",
            "phone",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
            sqlite_where=text("deleted_at IS NULL"),
        ),
    )
