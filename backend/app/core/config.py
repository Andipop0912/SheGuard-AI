import os
from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    PROJECT_NAME: str = "SheGuard AI Backend"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = "development"
    
    # Database Settings
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", 
        "postgresql://sheguard_user:sheguard_password@localhost:5432/sheguard_db"
    )
    
    # JWT Auth Settings
    JWT_SECRET: str = os.getenv(
        "JWT_SECRET", 
        "dev_secret_key_change_in_production_32bytes_min_length"
    )
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # Comma-separated in the environment (e.g. "https://app.example.com,https://admin.example.com").
    # Mobile HTTP clients are not subject to browser CORS at all; this only matters if a web
    # client is ever added. Defaults to "*" so the current mobile-only deployment is unaffected.
    CORS_ORIGINS: List[str] = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]

    # Communication Dispatch Engine Settings
    COMMUNICATION_PROVIDER_MODE: str = os.getenv("COMMUNICATION_PROVIDER_MODE", "mock") # "mock" or "real"
    # Retries after the first provider call: at most 1 + 2 = 3 provider calls per contact, ever.
    MAX_DISPATCH_RETRIES: int = 2
    # Server dispatches alerts itself when an open emergency first arrives via /emergencies/sync.
    AUTO_DISPATCH_ON_SYNC: bool = True
    # The phone uploads location points right after the emergency; wait briefly for one so the
    # SMS can include it. Proceeds immediately when a point arrives; omits the line if none.
    DISPATCH_LOCATION_GRACE_SECONDS: float = 8.0
    # A record left DISPATCHED longer than this (e.g. server restart mid-send) may be claimed again.
    DISPATCH_STALE_CLAIM_SECONDS: int = 300

    # Trusted contact limits (authoritative; the app mirrors them).
    MAX_TRUSTED_CONTACTS: int = 10
    MAX_ACTIVE_TRUSTED_CONTACTS: int = 5

    # SMS Provider Settings (Fast2SMS)
    SMS_PROVIDER: str = os.getenv("SMS_PROVIDER", "fast2sms") # "fast2sms" or "mock"
    FAST2SMS_API_KEY: str = os.getenv("FAST2SMS_API_KEY", "")
    FAST2SMS_BASE_URL: str = os.getenv("FAST2SMS_BASE_URL", "https://www.fast2sms.com/dev/bulkV2")
    HTTP_REQUEST_TIMEOUT_SECONDS: float = float(os.getenv("HTTP_REQUEST_TIMEOUT_SECONDS", "5.0"))
    # Emergency Location Settings
    LOCATION_SYNC_MAX_BATCH: int = 100
    # Resource limit per emergency (~8 h at the client's 15 s sampling policy).
    LOCATION_MAX_POINTS_PER_EMERGENCY: int = 2000
    # Reject fixes stamped further in the future than this (device clock skew allowance).
    LOCATION_MAX_FUTURE_SKEW_MS: int = 5 * 60 * 1000
    # Retention target after an emergency closes. Enforcement (purge job) is not implemented yet.
    LOCATION_RETENTION_DAYS_AFTER_CLOSE: int = 90

    RUN_REAL_SMS_TESTS: bool = os.getenv("RUN_REAL_SMS_TESTS", "false").lower() == "true"

    # Route Safety: base URL for the unauthenticated live-location link sent by SMS
    # (full link is f"{ROUTE_SAFETY_LIVE_BASE_URL}/{share_token}"). Must be set to the real
    # deployed backend URL in production; the dev default only works over the adb/LAN tunnel.
    ROUTE_SAFETY_LIVE_BASE_URL: str = os.getenv(
        "ROUTE_SAFETY_LIVE_BASE_URL", "http://localhost:8000/api/v1/route-safety/live"
    )

    # Supabase Storage: private bucket for evidence audio + incident report PDFs. The secret
    # (service-role) key is server-only — never sent to the app, never logged.
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "https://iulrqqygrnbzoqkpwciu.supabase.co")
    SUPABASE_BUCKET: str = os.getenv("SUPABASE_BUCKET", "sheguard-evidence")
    SUPABASE_SECRET_KEY: str = os.getenv("SUPABASE_SECRET_KEY", "")
    # How long a generated download link stays valid.
    SUPABASE_SIGNED_URL_TTL_SECONDS: int = 3600

    # Ask SheGuard AI (Gemini)
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    # Max tokens for a single Ask SheGuard response
    GEMINI_MAX_OUTPUT_TOKENS: int = 512
    # A slow/hung Gemini call must not block a request indefinitely; it must fail with a
    # controlled error instead (see ask_service.py).
    GEMINI_REQUEST_TIMEOUT_SECONDS: float = float(os.getenv("GEMINI_REQUEST_TIMEOUT_SECONDS", "15.0"))

    class Config:
        case_sensitive = True
        env_file = ".env"

settings = Settings()
