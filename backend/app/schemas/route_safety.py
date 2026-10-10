from pydantic import BaseModel, Field
from typing import Optional, List
from enum import Enum


class RouteSafetyStatus(str, Enum):
    ACTIVE = 'ACTIVE'
    ENDED = 'ENDED'
    CANCELLED = 'CANCELLED'


class RouteDeviationState(str, Enum):
    ON_ROUTE = 'ON_ROUTE'
    POSSIBLE_DEVIATION = 'POSSIBLE_DEVIATION'
    DEROUTED = 'DEROUTED'
    RETURNED_TO_ROUTE = 'RETURNED_TO_ROUTE'


class RoutePointDTO(BaseModel):
    latitude: float
    longitude: float


class CreateRouteSafetySessionRequest(BaseModel):
    sessionId: str = Field(..., alias="sessionId")
    deviceId: str = Field(..., alias="deviceId")
    startLocation: RoutePointDTO = Field(..., alias="startLocation")
    destinationText: str = Field(..., alias="destinationText")
    destinationLocation: Optional[RoutePointDTO] = Field(default=None, alias="destinationLocation")
    routePolyline: List[RoutePointDTO] = Field(default_factory=list, alias="routePolyline")
    routeDistanceMeters: Optional[float] = Field(default=None, alias="routeDistanceMeters")
    routeDurationSeconds: Optional[int] = Field(default=None, alias="routeDurationSeconds")
    startedAt: int = Field(..., alias="startedAt")

    class Config:
        populate_by_name = True


class RouteSafetySessionDTO(BaseModel):
    sessionId: str = Field(..., alias="sessionId")
    userId: str = Field(..., alias="userId")
    deviceId: str = Field(..., alias="deviceId")
    status: RouteSafetyStatus
    startLocation: RoutePointDTO = Field(..., alias="startLocation")
    destinationText: str = Field(..., alias="destinationText")
    destinationLocation: Optional[RoutePointDTO] = Field(default=None, alias="destinationLocation")
    routePolyline: List[RoutePointDTO] = Field(default_factory=list, alias="routePolyline")
    routeDistanceMeters: Optional[float] = Field(default=None, alias="routeDistanceMeters")
    routeDurationSeconds: Optional[int] = Field(default=None, alias="routeDurationSeconds")
    currentLocation: Optional[RoutePointDTO] = Field(default=None, alias="currentLocation")
    lastLocationAt: Optional[int] = Field(default=None, alias="lastLocationAt")
    deviationState: RouteDeviationState = Field(..., alias="deviationState")
    startedAt: int = Field(..., alias="startedAt")
    endedAt: Optional[str] = Field(default=None, alias="endedAt")

    class Config:
        populate_by_name = True
        from_attributes = True


class SyncRouteLocationRequest(BaseModel):
    latitude: float
    longitude: float
    timestamp: int


class EndRouteSafetySessionRequest(BaseModel):
    status: RouteSafetyStatus = RouteSafetyStatus.ENDED


class LiveLocationPublicDTO(BaseModel):
    """What an unauthenticated SMS link may see: no user/device identifiers, just the essentials."""
    status: RouteSafetyStatus
    destinationText: str = Field(..., alias="destinationText")
    currentLocation: Optional[RoutePointDTO] = Field(default=None, alias="currentLocation")
    lastLocationAt: Optional[int] = Field(default=None, alias="lastLocationAt")
    deviationState: RouteDeviationState = Field(..., alias="deviationState")

    class Config:
        populate_by_name = True
