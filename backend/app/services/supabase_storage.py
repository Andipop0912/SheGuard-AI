import logging
from dataclasses import dataclass
from typing import Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class UploadResult:
    success: bool
    bucket: str
    path: str
    error: Optional[str] = None


class SupabaseStorageError(Exception):
    pass


class SupabaseStorageClient:
    """
    Minimal REST client for Supabase Storage (private bucket). Deliberately not the official
    supabase-py SDK — this backend only needs upload + signed-URL generation, and a few plain
    httpx calls keep the dependency footprint and attack surface small.

    The service-role key never leaves this process: it is read from settings (server env only)
    and used only in the Authorization/apikey headers of these server-to-server calls.
    """

    def __init__(self, client: Optional[httpx.AsyncClient] = None):
        self._client = client
        self._base = settings.SUPABASE_URL.rstrip("/")
        self._bucket = settings.SUPABASE_BUCKET
        self._key = settings.SUPABASE_SECRET_KEY

    def is_configured(self) -> bool:
        return bool(self._key) and bool(self._base)

    def _headers(self, content_type: Optional[str] = None) -> dict:
        headers = {"Authorization": f"Bearer {self._key}", "apikey": self._key}
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    async def upload(self, path: str, data: bytes, content_type: str) -> UploadResult:
        if not self.is_configured():
            return UploadResult(success=False, bucket=self._bucket, path=path, error="Supabase is not configured")

        url = f"{self._base}/storage/v1/object/{self._bucket}/{path}"
        try:
            if self._client:
                res = await self._client.post(url, content=data, headers={**self._headers(content_type), "x-upsert": "true"})
            else:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    res = await client.post(url, content=data, headers={**self._headers(content_type), "x-upsert": "true"})
        except httpx.HTTPError as e:
            logger.warning(f"Supabase upload failed for {path}: {e}")
            return UploadResult(success=False, bucket=self._bucket, path=path, error=str(e))

        if res.status_code not in (200, 201):
            logger.warning(f"Supabase upload rejected for {path}: HTTP {res.status_code} {res.text[:200]}")
            return UploadResult(success=False, bucket=self._bucket, path=path, error=f"HTTP {res.status_code}")
        return UploadResult(success=True, bucket=self._bucket, path=path)

    async def create_signed_url(self, path: str, expires_in: Optional[int] = None) -> Optional[str]:
        if not self.is_configured():
            return None
        ttl = expires_in or settings.SUPABASE_SIGNED_URL_TTL_SECONDS
        url = f"{self._base}/storage/v1/object/sign/{self._bucket}/{path}"
        try:
            if self._client:
                res = await self._client.post(url, json={"expiresIn": ttl}, headers=self._headers("application/json"))
            else:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    res = await client.post(url, json={"expiresIn": ttl}, headers=self._headers("application/json"))
        except httpx.HTTPError as e:
            logger.warning(f"Supabase sign failed for {path}: {e}")
            return None

        if res.status_code != 200:
            logger.warning(f"Supabase sign rejected for {path}: HTTP {res.status_code}")
            return None
        signed_path = res.json().get("signedURL")
        if not signed_path:
            return None
        return f"{self._base}/storage/v1{signed_path}"
