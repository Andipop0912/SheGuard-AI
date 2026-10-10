import logging
import re
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Dict

from app.db.models.communication_log import (
    EmergencyCommunicationLog,
    CommunicationStatusEnum,
    CommunicationChannelEnum,
)
from app.db.models.trusted_contact import TrustedContact

logger = logging.getLogger(__name__)

@dataclass
class ProviderResponse:
    success: bool
    status: CommunicationStatusEnum
    provider_message_id: Optional[str] = None
    accepted_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None
    failed_at: Optional[datetime] = None
    failure_reason: Optional[str] = None
    is_retryable: bool = True
    supports_delivery_confirmation: bool = False
    # True when the provider is the development simulator (nothing was really sent).
    simulated: bool = False
    # True when no provider answer was received (timeout): the request may or may not have been sent.
    is_timeout: bool = False

class CommunicationProvider(ABC):
    """
    Provider-independent abstraction for emergency communication dispatch operations.
    Channel-specific concrete implementations (Sms, Fcm, VoiceCall) wrap underlying gateway SDKs.
    """

    @abstractmethod
    async def send_dispatch(
        self,
        log: EmergencyCommunicationLog,
        contact: TrustedContact,
        message: str,
    ) -> ProviderResponse:
        pass

    # Backwards compatibility method for Phase 2A signature
    async def send(self, log: EmergencyCommunicationLog, contact: TrustedContact) -> ProviderResponse:
        return await self.send_dispatch(log, contact, message="Emergency Alert")

class MockBaseProvider(CommunicationProvider):
    """
    Configurable deterministic mock provider base for channel-specific unit & integration testing.
    """

    def __init__(
        self,
        channel: CommunicationChannelEnum,
        should_fail: bool = False,
        is_retryable: bool = True,
        failure_reason: Optional[str] = None,
        confirm_delivery: bool = False,
    ):
        self.channel = channel
        self.should_fail = should_fail
        self.is_retryable = is_retryable
        self.failure_reason = failure_reason or f"Simulated {channel.value} provider dispatch failure"
        self.confirm_delivery = confirm_delivery
        self.call_count = 0

    async def send_dispatch(
        self,
        log: EmergencyCommunicationLog,
        contact: TrustedContact,
        message: str,
    ) -> ProviderResponse:
        self.call_count += 1
        now = datetime.now(timezone.utc)

        if self.should_fail:
            return ProviderResponse(
                success=False,
                status=CommunicationStatusEnum.FAILED,
                failed_at=now,
                failure_reason=self.failure_reason,
                is_retryable=self.is_retryable,
                simulated=True,
            )

        if self.confirm_delivery:
            return ProviderResponse(
                success=True,
                status=CommunicationStatusEnum.DELIVERED,
                provider_message_id=f"mock_{self.channel.value.lower()}_deliv_{uuid.uuid4().hex[:12]}",
                accepted_at=now,
                delivered_at=now,
                supports_delivery_confirmation=True,
                simulated=True,
            )

        return ProviderResponse(
            success=True,
            status=CommunicationStatusEnum.PROVIDER_ACCEPTED,
            provider_message_id=f"mock_{self.channel.value.lower()}_acc_{uuid.uuid4().hex[:12]}",
            accepted_at=now,
            supports_delivery_confirmation=False,
            simulated=True,
        )

def _mask_phones(text: str) -> str:
    """+919876543210 → +91********10 (development log only)."""
    return re.sub(r"\+91\d{8}(\d{2})", r"+91********\1", text)


class MockSmsProvider(MockBaseProvider):
    """
    Development SMS simulator: nothing is sent. Writes the SMS it WOULD have sent to the server
    log (phone numbers masked) so the server-built message can be checked during validation.
    """

    def __init__(self, **kwargs):
        super().__init__(channel=CommunicationChannelEnum.SMS, **kwargs)

    async def send_dispatch(self, log, contact, message):
        response = await super().send_dispatch(log, contact, message)
        logger.info(
            "SIMULATED SMS (not sent) event=%s to=%s result=%s text=%r",
            log.event_id,
            _mask_phones(contact.phone),
            response.status.value,
            _mask_phones(message),
        )
        return response

class MockFcmProvider(MockBaseProvider):
    def __init__(self, **kwargs):
        super().__init__(channel=CommunicationChannelEnum.FCM, **kwargs)

class MockVoiceCallProvider(MockBaseProvider):
    def __init__(self, **kwargs):
        super().__init__(channel=CommunicationChannelEnum.VOICE_CALL, **kwargs)

# Phase 2A backwards compatible alias
class MockCommunicationProvider(MockBaseProvider):
    def __init__(self, should_fail: bool = False, failure_reason: Optional[str] = None, **kwargs):
        super().__init__(
            channel=CommunicationChannelEnum.SMS,
            should_fail=should_fail,
            failure_reason=failure_reason,
            **kwargs,
        )

class ProviderRegistry:
    """
    Registry that resolves channel-specific communication providers based on mode or explicit overrides.
    """

    def __init__(self, overrides: Optional[Dict[CommunicationChannelEnum, CommunicationProvider]] = None):
        self._overrides = overrides or {}

    def get_provider(self, channel: CommunicationChannelEnum) -> Optional[CommunicationProvider]:
        """
        Returns the provider for a channel, or None when the channel is not available.
        Only SMS exists today (simulated in "mock" mode, Fast2SMS in "real" mode). FCM and voice
        calls have no provider, so they can never be reported as sent or accepted.
        """
        if channel in self._overrides:
            return self._overrides[channel]

        from app.core.config import settings
        mode = settings.COMMUNICATION_PROVIDER_MODE.lower()

        if channel == CommunicationChannelEnum.SMS:
            if mode == "real" and settings.SMS_PROVIDER.lower() == "fast2sms":
                from app.services.fast2sms_provider import Fast2SmsCommunicationProvider
                return Fast2SmsCommunicationProvider()
            return MockSmsProvider()
        return None

