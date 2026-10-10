import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional
import httpx

from app.core.config import settings
from app.db.models.communication_log import EmergencyCommunicationLog, CommunicationStatusEnum
from app.db.models.trusted_contact import TrustedContact
from app.services.communication_provider import CommunicationProvider, ProviderResponse

logger = logging.getLogger(__name__)

class Fast2SmsCommunicationProvider(CommunicationProvider):
    """
    Real SMS Gateway provider implementation using Fast2SMS API (bulkV2 endpoint).
    Normalizes Fast2SMS responses into the standard ProviderResponse interface.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: Optional[float] = None,
        client: Optional[httpx.AsyncClient] = None,
    ):
        # An explicitly passed key (even "") is used as-is; only an omitted key falls back to config.
        self.api_key = api_key if api_key is not None else settings.FAST2SMS_API_KEY
        self.base_url = base_url or settings.FAST2SMS_BASE_URL
        self.timeout = timeout if timeout is not None else settings.HTTP_REQUEST_TIMEOUT_SECONDS
        self._client = client

    @staticmethod
    def sanitize_phone_number(phone: str) -> str:
        """
        Sanitizes phone number format for Fast2SMS (10-digit Indian mobile number format).
        Strips country code +91 or leading 91 if present.
        """
        digits = re.sub(r"\D", "", phone)
        if len(digits) == 12 and digits.startswith("91"):
            digits = digits[2:]
        elif len(digits) == 11 and digits.startswith("0"):
            digits = digits[1:]
        return digits

    async def send_dispatch(
        self,
        log: EmergencyCommunicationLog,
        contact: TrustedContact,
        message: str,
    ) -> ProviderResponse:
        now = datetime.now(timezone.utc)

        # Guard: API Key configuration check
        if not self.api_key:
            logger.error("Fast2SMS dispatch attempted without FAST2SMS_API_KEY configured")
            return ProviderResponse(
                success=False,
                status=CommunicationStatusEnum.FAILED,
                failed_at=now,
                failure_reason="Fast2SMS API key not configured",
                is_retryable=False,
            )

        number_str = self.sanitize_phone_number(contact.phone)
        payload = {
            "route": "q",
            "message": message,
            "language": "english",
            "flash": 0,
            "numbers": number_str,
        }
        headers = {
            "authorization": self.api_key,
            "Content-Type": "application/json",
        }

        # Sanitized logging (API KEY & raw authorization header NEVER logged)
        logger.info(
            f"Dispatching Fast2SMS request for log_id={log.id}, "
            f"event_id={log.event_id}, contact_id={contact.id}"
        )

        try:
            if self._client:
                res = await self._client.post(self.base_url, json=payload, headers=headers)
            else:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    res = await client.post(self.base_url, json=payload, headers=headers)
        except httpx.TimeoutException as te:
            logger.warning(f"Fast2SMS HTTP timeout for log {log.id}: {te}")
            return ProviderResponse(
                success=False,
                status=CommunicationStatusEnum.FAILED,
                failed_at=now,
                failure_reason="Fast2SMS gateway HTTP timeout",
                is_retryable=True,
                is_timeout=True,
            )
        except httpx.NetworkError as ne:
            logger.warning(f"Fast2SMS network error for log {log.id}: {ne}")
            return ProviderResponse(
                success=False,
                status=CommunicationStatusEnum.FAILED,
                failed_at=now,
                failure_reason=f"Fast2SMS network connection error: {ne}",
                is_retryable=True,
            )
        except Exception as exc:
            logger.error(f"Fast2SMS client exception for log {log.id}: {exc}")
            return ProviderResponse(
                success=False,
                status=CommunicationStatusEnum.FAILED,
                failed_at=now,
                failure_reason=f"Fast2SMS exception: {str(exc)}",
                is_retryable=False,
            )

        # HTTP status handling & retry classification
        if res.status_code in (401, 403):
            logger.error(f"Fast2SMS authentication rejected with HTTP {res.status_code}")
            return ProviderResponse(
                success=False,
                status=CommunicationStatusEnum.FAILED,
                failed_at=now,
                failure_reason=f"Fast2SMS authentication failed (HTTP {res.status_code})",
                is_retryable=False,
            )
        elif res.status_code >= 500:
            logger.warning(f"Fast2SMS server error HTTP {res.status_code}")
            return ProviderResponse(
                success=False,
                status=CommunicationStatusEnum.FAILED,
                failed_at=now,
                failure_reason=f"Fast2SMS server error (HTTP {res.status_code})",
                is_retryable=True,
            )
        elif res.status_code != 200:
            return ProviderResponse(
                success=False,
                status=CommunicationStatusEnum.FAILED,
                failed_at=now,
                failure_reason=f"Fast2SMS HTTP error (HTTP {res.status_code})",
                is_retryable=False,
            )

        # Parse Fast2SMS JSON response body
        try:
            body = res.json()
        except Exception as json_err:
            logger.error(f"Failed to parse Fast2SMS response JSON: {json_err}")
            return ProviderResponse(
                success=False,
                status=CommunicationStatusEnum.FAILED,
                failed_at=now,
                failure_reason="Malformed JSON response from Fast2SMS",
                is_retryable=False,
            )

        if isinstance(body, dict) and body.get("return") is True:
            request_id = body.get("request_id") or f"fast2sms_{uuid.uuid4().hex[:10]}"
            return ProviderResponse(
                success=True,
                status=CommunicationStatusEnum.PROVIDER_ACCEPTED,
                provider_message_id=str(request_id),
                accepted_at=now,
                supports_delivery_confirmation=False, # Truthful delivery: Accepted by provider, not confirmed delivered
            )
        else:
            msg = body.get("message") if isinstance(body, dict) else "Fast2SMS rejected dispatch"
            if isinstance(msg, list):
                msg = ", ".join(str(m) for m in msg)
            return ProviderResponse(
                success=False,
                status=CommunicationStatusEnum.FAILED,
                failed_at=now,
                failure_reason=f"Fast2SMS rejection: {msg}",
                is_retryable=False,
            )
