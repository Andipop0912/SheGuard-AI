"""Safety net: the test suite can never use a real SMS key or reach a real SMS provider."""
import pytest

from app.core.config import settings
from app.services.fast2sms_provider import Fast2SmsCommunicationProvider
from app.services.communication_provider import MockSmsProvider, ProviderRegistry
from app.db.models.communication_log import CommunicationChannelEnum
from tests.test_fast2sms_provider import make_dummy_log_and_contact


def test_no_real_key_and_simulated_provider_in_tests():
    assert settings.FAST2SMS_API_KEY == ""
    assert isinstance(ProviderRegistry().get_provider(CommunicationChannelEnum.SMS), MockSmsProvider)


@pytest.mark.asyncio
async def test_real_network_is_refused_even_with_a_key():
    log, contact = make_dummy_log_and_contact()
    provider = Fast2SmsCommunicationProvider(api_key="looks-real")  # no injected client
    result = await provider.send_dispatch(log, contact, "test")
    assert result.success is False
    assert "Real network access is disabled in tests" in (result.failure_reason or "")
