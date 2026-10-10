from pydantic import BaseModel, Field
from typing import Optional
import uuid

class DeviceResponse(BaseModel):
    id: uuid.UUID
    deviceId: str = Field(..., alias="deviceId")
    userId: uuid.UUID = Field(..., alias="userId")
    platform: str
    osVersion: Optional[str] = Field(default=None, alias="osVersion")
    appVersion: Optional[str] = Field(default=None, alias="appVersion")
    isActive: bool = Field(..., alias="isActive")

    class Config:
        populate_by_name = True
        from_attributes = True
