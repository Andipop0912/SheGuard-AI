from pydantic import BaseModel, Field, model_validator
from typing import Optional, Dict, Any, List
from enum import Enum

class EmergencyStateEnum(str, Enum):
    IDLE = 'IDLE'
    TRIGGERED = 'TRIGGERED'
    RESPONDING = 'RESPONDING'
    NOTIFYING = 'NOTIFYING'
    MONITORING = 'MONITORING'
    RESOLVED = 'RESOLVED'
    CANCELLED = 'CANCELLED'

class EmergencyTriggerSourceEnum(str, Enum):
    MANUAL_SOS = 'MANUAL_SOS'
    VOICE = 'VOICE'
    GESTURE = 'GESTURE'
    HARDWARE_BUTTON = 'HARDWARE_BUTTON'
    SYSTEM = 'SYSTEM'

class SyncItemResultStatus(str, Enum):
    SYNCED = 'SYNCED'
    ALREADY_SYNCED = 'ALREADY_SYNCED'
    UPDATED = 'UPDATED'
    FAILED = 'FAILED'

class EmergencyEventDTO(BaseModel):
    eventId: str = Field(..., alias="eventId")
    userId: str = Field(..., alias="userId")
    deviceId: str = Field(..., alias="deviceId")
    triggerSource: EmergencyTriggerSourceEnum = Field(..., alias="triggerSource")
    state: EmergencyStateEnum = Field(default=EmergencyStateEnum.TRIGGERED)
    createdAt: int = Field(..., alias="createdAt")
    updatedAt: int = Field(..., alias="updatedAt")
    resolvedAt: Optional[int] = Field(default=None, alias="resolvedAt")
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)

    @model_validator(mode='before')
    @classmethod
    def handle_client_field_aliases(cls, values: Any) -> Any:
        if isinstance(values, dict):
            if 'clientCreatedAt' in values and 'createdAt' not in values:
                values['createdAt'] = values['clientCreatedAt']
            if 'clientUpdatedAt' in values and 'updatedAt' not in values:
                values['updatedAt'] = values['clientUpdatedAt']
        return values

    class Config:
        populate_by_name = True
        from_attributes = True

class EmergencyBatchSyncRequest(BaseModel):
    events: List[EmergencyEventDTO] = Field(..., min_length=1)

class EmergencySyncResultItem(BaseModel):
    eventId: str = Field(..., alias="eventId")
    status: SyncItemResultStatus
    serverReceivedAt: str = Field(..., alias="serverReceivedAt")
    message: Optional[str] = None

    class Config:
        populate_by_name = True

class EmergencyBatchSyncResponse(BaseModel):
    results: List[EmergencySyncResultItem]

    class Config:
        populate_by_name = True
