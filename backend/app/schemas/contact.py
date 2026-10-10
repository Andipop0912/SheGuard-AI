import re
from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field, field_validator

# Indian mobile numbers only (the SMS provider is India-only): optional +91 / 91 / 0 prefix,
# then 10 digits starting 6-9. Stored as +91XXXXXXXXXX.
INDIAN_MOBILE_REGEX = re.compile(r"^(?:\+91|91|0)?([6-9]\d{9})$")
INVALID_PHONE_MESSAGE = "Enter a valid Indian mobile number (10 digits, optionally with +91)"


def normalize_indian_mobile(value: str) -> str:
    cleaned = re.sub(r"[\s\-\(\)]", "", value)
    match = INDIAN_MOBILE_REGEX.match(cleaned)
    if not match:
        raise ValueError(INVALID_PHONE_MESSAGE)
    return f"+91{match.group(1)}"


def _clean_relationship(v: Optional[str]) -> Optional[str]:
    if v is None:
        return v
    trimmed = v.strip()
    return trimmed or None


class TrustedContactBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Full name of the contact")
    phone: str = Field(..., description="Indian mobile number; stored normalized as +91XXXXXXXXXX")
    relationship: Optional[str] = Field(None, max_length=50, description="Relationship to user (e.g., Mother, Spouse)")
    priority: int = Field(1, ge=1, le=100, description="Notification priority order (1 = highest)")
    is_active: bool = Field(True, description="Whether this contact is active for alerts")

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("Contact name cannot be empty or whitespace only")
        return trimmed

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        return normalize_indian_mobile(v)

    @field_validator("relationship")
    @classmethod
    def validate_relationship(cls, v: Optional[str]) -> Optional[str]:
        return _clean_relationship(v)

class TrustedContactCreate(TrustedContactBase):
    pass

class TrustedContactUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    phone: Optional[str] = None
    relationship: Optional[str] = Field(None, max_length=50)
    priority: Optional[int] = Field(None, ge=1, le=100)
    is_active: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            trimmed = v.strip()
            if not trimmed:
                raise ValueError("Contact name cannot be empty or whitespace only")
            return trimmed
        return v

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: Optional[str]) -> Optional[str]:
        return normalize_indian_mobile(v) if v is not None else v

    @field_validator("relationship")
    @classmethod
    def validate_relationship(cls, v: Optional[str]) -> Optional[str]:
        return _clean_relationship(v)

class TrustedContactDTO(BaseModel):
    """Output: values come from the database (already validated and normalized)."""
    id: UUID
    user_id: UUID
    name: str
    phone: str
    relationship: Optional[str] = None
    priority: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
