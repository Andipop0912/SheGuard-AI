from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field
from app.core.config import settings
from app.schemas.emergency import SyncItemResultStatus


class LocationKind(str, Enum):
    SNAPSHOT = 'SNAPSHOT'
    UPDATE = 'UPDATE'


class LocationProvider(str, Enum):
    FUSED = 'FUSED'
    GPS = 'GPS'
    NETWORK = 'NETWORK'
    PASSIVE = 'PASSIVE'
    UNKNOWN = 'UNKNOWN'


class LocationPointDTO(BaseModel):
    locationId: str = Field(..., min_length=1, max_length=64)
    kind: LocationKind
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    accuracyMeters: Optional[float] = Field(default=None, ge=0)
    altitudeMeters: Optional[float] = None
    speedMps: Optional[float] = Field(default=None, ge=0)
    headingDegrees: Optional[float] = Field(default=None, ge=0, lt=360)
    provider: LocationProvider = LocationProvider.UNKNOWN
    isLastKnown: bool = False
    capturedAt: int = Field(..., gt=0, description="Device epoch milliseconds")


class LocationBatchSyncRequest(BaseModel):
    points: List[LocationPointDTO] = Field(..., min_length=1, max_length=settings.LOCATION_SYNC_MAX_BATCH)


class LocationSyncResultItem(BaseModel):
    locationId: str
    status: SyncItemResultStatus
    message: Optional[str] = None


class LocationBatchSyncResponse(BaseModel):
    eventId: str
    results: List[LocationSyncResultItem]
    storedCount: int


class LocationPointResponse(BaseModel):
    locationId: str
    kind: LocationKind
    latitude: float
    longitude: float
    accuracyMeters: Optional[float]
    altitudeMeters: Optional[float]
    speedMps: Optional[float]
    headingDegrees: Optional[float]
    provider: str
    isLastKnown: bool
    capturedAt: int
