from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session
from app.core.dependencies import get_db
from app.schemas.auth import (
    UserRegisterRequest,
    UserLoginRequest,
    RefreshTokenRequest,
    LogoutRequest,
    TokenResponse
)
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["Authentication"])

@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED, summary="Register user & bind mobile device")
def register(req: UserRegisterRequest, db: Session = Depends(get_db)):
    return AuthService.register_user(db, req)

@router.post("/login", response_model=TokenResponse, status_code=status.HTTP_200_OK, summary="Login user & bind mobile device")
def login(req: UserLoginRequest, db: Session = Depends(get_db)):
    return AuthService.login_user(db, req)

@router.post("/refresh", response_model=TokenResponse, status_code=status.HTTP_200_OK, summary="Refresh access token")
def refresh(req: RefreshTokenRequest, db: Session = Depends(get_db)):
    return AuthService.refresh_access_token(db, req.refreshToken, req.deviceId)

@router.post("/logout", status_code=status.HTTP_200_OK, summary="Revoke refresh token session")
def logout(req: LogoutRequest, db: Session = Depends(get_db)):
    success = AuthService.logout_user(db, req.refreshToken)
    return {"success": success, "message": "Logged out successfully" if success else "Token already revoked or invalid"}
