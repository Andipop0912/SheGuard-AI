from datetime import datetime
from typing import Optional, List
from uuid import UUID
from pydantic import BaseModel, Field
from app.db.models.communication_log import CommunicationChannelEnum, CommunicationStatusEnum

class CommunicationLogDTO(BaseModel):
    """A server-created communication record, with a snapshot of the contact it was for."""
    id: UUID
    event_id: str
    contact_id: UUID
    contact_name: str
    contact_phone: str
    # The contact was removed later; the record is kept as history.
    contact_deleted: bool
    channel: CommunicationChannelEnum
    status: CommunicationStatusEnum
    reason_code: Optional[str] = None
    failure_reason: Optional[str] = None
    # True when the development SMS simulator was used: nothing was really sent.
    is_simulated: bool
    attempt_count: int
    provider_message_id: Optional[str] = None
    attempted_at: datetime
    provider_accepted_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None
    failed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

class DispatchEmergencyRequest(BaseModel):
    """Server-internal dispatch options (no client input reaches the message or the contact list)."""
    channels: Optional[List[CommunicationChannelEnum]] = Field(
        default_factory=lambda: [CommunicationChannelEnum.SMS],
        description="Channels to attempt (only SMS has a provider today)",
    )

class DispatchAttemptSummary(BaseModel):
    id: UUID
    contact_id: UUID
    contact_name: str
    contact_phone: str
    channel: CommunicationChannelEnum
    status: CommunicationStatusEnum
    reason_code: Optional[str] = None
    is_simulated: bool = False
    attempt_count: int = 0
    provider_message_id: Optional[str] = None
    failure_reason: Optional[str] = None
    attempted_at: datetime

class EmergencyDispatchSummary(BaseModel):
    event_id: str
    total_contacts: int
    total_attempts: int
    successful_attempts: int
    failed_attempts: int
    attempts: List[DispatchAttemptSummary]
