import pytest
import uuid
import logging
import httpx
from unittest.mock import patch, MagicMock
from app.core.config import settings
from app.db.models.communication_log import EmergencyCommunicationLog, CommunicationChannelEnum, CommunicationStatusEnum
from app.db.models.trusted_contact import TrustedContact
from app.services.fast2sms_provider import Fast2SmsCommunicationProvider
from app.services.communication_provider import (
    ProviderRegistry,
    MockSmsProvider,
    ProviderResponse,
)

def make_dummy_log_and_contact(phone="+919876543210"):
    log = EmergencyCommunicationLog(
        id=uuid.uuid4(),
        event_id="evt_test_123",
        contact_id=uuid.uuid4(),
        channel=CommunicationChannelEnum.SMS,
        status=CommunicationStatusEnum.QUEUED,
    )
    contact = TrustedContact(
        id=log.contact_id,
        user_id=uuid.uuid4(),
        name="Guardian",
        phone=phone,
        priority=1,
    )
    return log, contact

@pytest.mark.asyncio
async def test_phone_number_sanitization():
    assert Fast2SmsCommunicationProvider.sanitize_phone_number("+919876543210") == "9876543210"
    assert Fast2SmsCommunicationProvider.sanitize_phone_number("9876543210") == "9876543210"
    assert Fast2SmsCommunicationProvider.sanitize_phone_number("+1-987-654-3210") == "19876543210"
    assert Fast2SmsCommunicationProvider.sanitize_phone_number("+91 98765 43210") == "9876543210"

@pytest.mark.asyncio
async def test_fast2sms_success_response():
    log, contact = make_dummy_log_and_contact()
    
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers.get("authorization") == "test_api_key"
        assert request.headers.get("content-type") == "application/json"
        return httpx.Response(
            status_code=200,
            json={
                "return": True,
                "request_id": "req_fast2sms_12345",
                "message": ["SMS sent successfully"]
            }
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = Fast2SmsCommunicationProvider(api_key="test_api_key", client=client)
        result = await provider.send_dispatch(log, contact, "Emergency SOS message")

    assert result.success is True
    assert result.status == CommunicationStatusEnum.PROVIDER_ACCEPTED
    assert result.provider_message_id == "req_fast2sms_12345"
    assert result.supports_delivery_confirmation is False
    assert result.failure_reason is None

@pytest.mark.asyncio
async def test_fast2sms_rejection_response():
    log, contact = make_dummy_log_and_contact()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status_code=200,
            json={
                "return": False,
                "message": "Invalid Mobile Number"
            }
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = Fast2SmsCommunicationProvider(api_key="test_api_key", client=client)
        result = await provider.send_dispatch(log, contact, "Emergency SOS message")

    assert result.success is False
    assert result.status == CommunicationStatusEnum.FAILED
    assert "PROVIDER_REJECTED" in (result.failure_reason or "") or "Invalid Mobile Number" in (result.failure_reason or "")
    assert result.is_retryable is False

@pytest.mark.asyncio
async def test_fast2sms_http_4xx_error():
    log, contact = make_dummy_log_and_contact()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status_code=401,
            json={"message": "Unauthorized API key"}
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = Fast2SmsCommunicationProvider(api_key="invalid_key", client=client)
        result = await provider.send_dispatch(log, contact, "SOS")

    assert result.success is False
    assert result.status == CommunicationStatusEnum.FAILED
    assert "HTTP 401" in (result.failure_reason or "")
    assert result.is_retryable is False

@pytest.mark.asyncio
async def test_fast2sms_http_5xx_error():
    log, contact = make_dummy_log_and_contact()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=503, text="Service Unavailable")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = Fast2SmsCommunicationProvider(api_key="test_key", client=client)
        result = await provider.send_dispatch(log, contact, "SOS")

    assert result.success is False
    assert result.status == CommunicationStatusEnum.FAILED
    assert "HTTP 503" in (result.failure_reason or "")
    assert result.is_retryable is True

@pytest.mark.asyncio
async def test_fast2sms_timeout():
    log, contact = make_dummy_log_and_contact()

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("Connection timed out")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = Fast2SmsCommunicationProvider(api_key="test_key", client=client)
        result = await provider.send_dispatch(log, contact, "SOS")

    assert result.success is False
    assert result.status == CommunicationStatusEnum.FAILED
    assert "timeout" in (result.failure_reason or "").lower()
    assert result.is_retryable is True

@pytest.mark.asyncio
async def test_fast2sms_network_error():
    log, contact = make_dummy_log_and_contact()

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.NetworkError("DNS resolution failed")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = Fast2SmsCommunicationProvider(api_key="test_key", client=client)
        result = await provider.send_dispatch(log, contact, "SOS")

    assert result.success is False
    assert result.status == CommunicationStatusEnum.FAILED
    assert "network" in (result.failure_reason or "").lower()
    assert result.is_retryable is True

@pytest.mark.asyncio
async def test_fast2sms_malformed_json():
    log, contact = make_dummy_log_and_contact()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=200, text="NOT_JSON_BODY")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = Fast2SmsCommunicationProvider(api_key="test_key", client=client)
        result = await provider.send_dispatch(log, contact, "SOS")

    assert result.success is False
    assert result.status == CommunicationStatusEnum.FAILED
    assert "json" in (result.failure_reason or "").lower() or "malformed" in (result.failure_reason or "").lower()
    assert result.is_retryable is False

@pytest.mark.asyncio
async def test_fast2sms_missing_api_key():
    log, contact = make_dummy_log_and_contact()
    provider = Fast2SmsCommunicationProvider(api_key="")
    result = await provider.send_dispatch(log, contact, "SOS")
    assert result.success is False
    assert result.is_retryable is False
    assert "API key" in (result.failure_reason or "")

@pytest.mark.asyncio
async def test_provider_registry_mock_mode():
    with patch.object(settings, "COMMUNICATION_PROVIDER_MODE", "mock"):
        registry = ProviderRegistry()
        provider = registry.get_provider(CommunicationChannelEnum.SMS)
        assert isinstance(provider, MockSmsProvider)

@pytest.mark.asyncio
async def test_provider_registry_real_mode_fast2sms():
    with patch.object(settings, "COMMUNICATION_PROVIDER_MODE", "real"):
        with patch.object(settings, "SMS_PROVIDER", "fast2sms"):
            with patch.object(settings, "FAST2SMS_API_KEY", "real_key_123"):
                registry = ProviderRegistry()
                provider = registry.get_provider(CommunicationChannelEnum.SMS)
                assert isinstance(provider, Fast2SmsCommunicationProvider)
                assert provider.api_key == "real_key_123"

@pytest.mark.asyncio
async def test_api_key_not_in_logs(caplog):
    log, contact = make_dummy_log_and_contact()
    secret_key = "SECRET_SUPER_CONFIDENTIAL_KEY_999"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=401, json={"message": "Unauthorized"})

    transport = httpx.MockTransport(handler)
    with caplog.at_level(logging.INFO):
        async with httpx.AsyncClient(transport=transport) as client:
            provider = Fast2SmsCommunicationProvider(api_key=secret_key, client=client)
            await provider.send_dispatch(log, contact, "SOS")

    logged_text = caplog.text
    assert secret_key not in logged_text
