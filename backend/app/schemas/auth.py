from pydantic import BaseModel, Field
from typing import Optional
import uuid

class UserRegisterRequest(BaseModel):
    phone: str = Field(..., min_length=8, max_length=20, example="+1234567890")
    password: str = Field(..., min_length=6, max_length=100)
    deviceId: str = Field(..., alias="deviceId", example="dev-android-01")
    platform: Optional[str] = Field(default="android")
    osVersion: Optional[str] = Field(default=None, alias="osVersion")
    appVersion: Optional[str] = Field(default=None, alias="appVersion")

    class Config:
        populate_by_name = True

class UserLoginRequest(BaseModel):
    phone: str = Field(..., example="+1234567890")
    password: str = Field(...)
    deviceId: str = Field(..., alias="deviceId", example="dev-android-01")

    class Config:
        populate_by_name = True

class RefreshTokenRequest(BaseModel):
    refreshToken: str = Field(..., alias="refreshToken")
    deviceId: str = Field(..., alias="deviceId")

    class Config:
        populate_by_name = True

class LogoutRequest(BaseModel):
    refreshToken: str = Field(..., alias="refreshToken")

    class Config:
        populate_by_name = True

class TokenResponse(BaseModel):
    accessToken: str = Field(..., alias="accessToken")
    refreshToken: str = Field(..., alias="refreshToken")
    tokenType: str = Field(default="bearer", alias="tokenType")
    userId: str = Field(..., alias="userId")
    deviceId: str = Field(..., alias="deviceId")

    class Config:
        populate_by_name = True

class UserResponse(BaseModel):
    id: uuid.UUID
    phone: str
    isActive: bool = Field(..., alias="isActive")

    class Config:
        populate_by_name = True
        from_attributes = True
