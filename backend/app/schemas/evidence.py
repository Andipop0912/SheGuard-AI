from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class EvidenceUploadStatus(str, Enum):
    PENDING = 'PENDING'
    UPLOADED = 'UPLOADED'
    FAILED = 'FAILED'


class EvidenceItemDTO(BaseModel):
    evidenceId: str = Field(..., alias="evidenceId")
    eventId: str = Field(..., alias="eventId")
    type: str
    durationMs: Optional[int] = Field(default=None, alias="durationMs")
    uploadStatus: EvidenceUploadStatus = Field(..., alias="uploadStatus")

    class Config:
        populate_by_name = True


class SignedUrlResponse(BaseModel):
    url: str


class IncidentReportResponse(BaseModel):
    reportId: str = Field(..., alias="reportId")
    url: Optional[str] = None

    class Config:
        populate_by_name = True


class EvidenceDeliveryResponse(BaseModel):
    delivered: bool
    contactsNotified: int = Field(..., alias="contactsNotified")

    class Config:
        populate_by_name = True
