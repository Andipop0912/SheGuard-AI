from datetime import datetime, timedelta, timezone
from typing import Tuple, Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from app.db.models.user import User
from app.db.models.device import Device
from app.db.models.refresh_session import RefreshSession
from app.core.security import (
    hash_password,
    verify_password,
    hash_token,
    create_access_token,
    create_refresh_token,
)
from app.core.config import settings
from app.schemas.auth import UserRegisterRequest, UserLoginRequest, TokenResponse

class AuthService:

    @staticmethod
    def register_user(db: Session, req: UserRegisterRequest) -> TokenResponse:
        # 1. Check duplicate phone
        existing_user = db.query(User).filter(User.phone == req.phone).first()
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User with this phone number already exists."
            )

        # 2. Create User
        user = User(
            phone=req.phone,
            password_hash=hash_password(req.password),
            is_active=True
        )
        db.add(user)
        db.flush()

        # 3. Create or bind Device
        device = db.query(Device).filter(
            Device.user_id == user.id,
            Device.device_id == req.deviceId
        ).first()

        if not device:
            device = Device(
                user_id=user.id,
                device_id=req.deviceId,
                platform=req.platform or "android",
                os_version=req.osVersion,
                app_version=req.appVersion,
                is_active=True
            )
            db.add(device)

        # 4. Issue Tokens
        access_token = create_access_token(subject=str(user.id), device_id=req.deviceId)
        raw_refresh_token = create_refresh_token()
        refresh_hash = hash_token(raw_refresh_token)

        expires_at = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

        refresh_session = RefreshSession(
            user_id=user.id,
            device_id=req.deviceId,
            token_hash=refresh_hash,
            expires_at=expires_at
        )
        db.add(refresh_session)
        db.commit()

        return TokenResponse(
            accessToken=access_token,
            refreshToken=raw_refresh_token,
            tokenType="bearer",
            userId=str(user.id),
            deviceId=req.deviceId
        )

    @staticmethod
    def login_user(db: Session, req: UserLoginRequest) -> TokenResponse:
        # 1. Authenticate user by phone
        user = db.query(User).filter(User.phone == req.phone).first()
        if not user or not verify_password(req.password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid phone number or password."
            )

        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is inactive."
            )

        # 2. Bind/verify device
        device = db.query(Device).filter(
            Device.user_id == user.id,
            Device.device_id == req.deviceId
        ).first()

        if not device:
            device = Device(
                user_id=user.id,
                device_id=req.deviceId,
                platform="android",
                is_active=True
            )
            db.add(device)
        else:
            device.is_active = True
            device.updated_at = datetime.now(timezone.utc)

        # 3. Create Refresh Session & Tokens
        access_token = create_access_token(subject=str(user.id), device_id=req.deviceId)
        raw_refresh_token = create_refresh_token()
        refresh_hash = hash_token(raw_refresh_token)

        expires_at = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

        refresh_session = RefreshSession(
            user_id=user.id,
            device_id=req.deviceId,
            token_hash=refresh_hash,
            expires_at=expires_at
        )
        db.add(refresh_session)
        db.commit()

        return TokenResponse(
            accessToken=access_token,
            refreshToken=raw_refresh_token,
            tokenType="bearer",
            userId=str(user.id),
            deviceId=req.deviceId
        )

    @staticmethod
    def refresh_access_token(db: Session, refresh_token: str, device_id: str) -> TokenResponse:
        token_hash_str = hash_token(refresh_token)
        session = db.query(RefreshSession).filter(
            RefreshSession.token_hash == token_hash_str,
            RefreshSession.device_id == device_id,
            RefreshSession.revoked_at.is_(None)
        ).first()

        if not session:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or revoked refresh token."
            )

        now = datetime.now(timezone.utc)
        expires_at = session.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)

        if expires_at < now:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Refresh token has expired."
            )

        user = db.query(User).filter(User.id == session.user_id, User.is_active == True).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User inactive or missing."
            )

        # A deactivated (unbound) device may not obtain new tokens, even with a valid refresh token.
        device = db.query(Device).filter(
            Device.user_id == user.id,
            Device.device_id == device_id,
            Device.is_active == True
        ).first()
        if not device:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Device is not authorized for this account."
            )

        # Revoke old refresh session
        session.revoked_at = now

        # Issue new pair
        new_access_token = create_access_token(subject=str(user.id), device_id=device_id)
        new_raw_refresh_token = create_refresh_token()
        new_refresh_hash = hash_token(new_raw_refresh_token)
        new_expires_at = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

        new_session = RefreshSession(
            user_id=user.id,
            device_id=device_id,
            token_hash=new_refresh_hash,
            expires_at=new_expires_at
        )
        db.add(new_session)
        db.commit()

        return TokenResponse(
            accessToken=new_access_token,
            refreshToken=new_raw_refresh_token,
            tokenType="bearer",
            userId=str(user.id),
            deviceId=device_id
        )

    @staticmethod
    def logout_user(db: Session, refresh_token: str) -> bool:
        token_hash_str = hash_token(refresh_token)
        session = db.query(RefreshSession).filter(
            RefreshSession.token_hash == token_hash_str
        ).first()

        if session and session.revoked_at is None:
            session.revoked_at = datetime.now(timezone.utc)
            db.commit()
            return True
        return False
