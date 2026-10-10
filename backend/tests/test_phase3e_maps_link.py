"""Phase 3E: Google Maps link (latest server-stored emergency location) in the emergency SMS."""
import math
import uuid

import pytest
from fastapi import status

from app.core.dependencies import get_provider_registry_factory
from app.db.models.communication_log import CommunicationChannelEnum
from app.main import app
from app.services.communication_provider import MockSmsProvider, ProviderRegistry
from app.services.communication_service import dispatch_emergency_communications
from app.services.message_builder import (
    GOOGLE_MAPS_SEARCH_URL,
    GoogleMapsLinkRenderer,
    MessageLocation,
    google_maps_url,
)

CREATED_MS = 1728000000000  # 05:30 IST


# ---------------------------------------------------------------- URL builder (16–20)

def test_valid_coordinates_build_google_maps_search_url():
    assert google_maps_url(19.2819, 72.8684) == "https://www.google.com/maps/search/?api=1&query=19.28190%2C72.86840"


def test_url_is_encoded_and_handles_negative_and_boundary_values():
    assert google_maps_url(-33.8688, 151.2093) == f"{GOOGLE_MAPS_SEARCH_URL}-33.86880%2C151.20930"
    assert google_maps_url(90, -180) == f"{GOOGLE_MAPS_SEARCH_URL}90.00000%2C-180.00000"
    url = google_maps_url(12.3456789, 76.54321)
    assert "," not in url.split("query=")[1]  # the separator is percent-encoded
    assert " " not in url


def test_no_api_key_in_url():
    url = google_maps_url(19.0426, 73.0231)
    assert "key=" not in url.lower() and "api_key" not in url.lower() and "AIza" not in url


@pytest.mark.parametrize("lat,lon", [
    (91, 0), (-90.0001, 0), (0, 180.5), (0, -181), (math.nan, 1), (1, math.inf), ("x", 1), (None, 2),
])
def test_invalid_coordinates_produce_no_url(lat, lon):
    assert google_maps_url(lat, lon) is None


def test_renderer_omits_line_for_invalid_location():
    renderer = GoogleMapsLinkRenderer()
    assert renderer.render(MessageLocation(latitude=200.0, longitude=0.0, accuracy_m=5, captured_at_ms=1)) is None
    assert renderer.render(MessageLocation(latitude=19.0, longitude=73.0, accuracy_m=None, captured_at_ms=1)) == (
        f"Location: {GOOGLE_MAPS_SEARCH_URL}19.00000%2C73.00000"
    )


# ---------------------------------------------------------------- SMS integration (21–25)

def register(client, phone, device_id):
    resp = client.post("/api/v1/auth/register", json={"phone": phone, "password": "Password123!", "deviceId": device_id})
    assert resp.status_code == status.HTTP_201_CREATED, resp.json()
    data = resp.json()
    return {"Authorization": f"Bearer {data['accessToken']}"}, data["userId"]


def sync(client, headers, user_id, device_id, event_id, updated=CREATED_MS, state="RESPONDING"):
    resp = client.post("/api/v1/emergencies/sync", json={"events": [{
        "eventId": event_id, "userId": user_id, "deviceId": device_id, "triggerSource": "MANUAL_SOS",
        "state": state, "createdAt": CREATED_MS, "updatedAt": updated, "resolvedAt": None, "metadata": {},
    }]}, headers=headers)
    assert resp.status_code == 200, resp.json()


def upload_points(client, headers, event_id, points):
    resp = client.post(f"/api/v1/emergencies/{event_id}/locations/sync", json={"points": [
        {"locationId": f"{event_id}-{i}", "kind": "SNAPSHOT" if i == 0 else "UPDATE", "latitude": lat,
         "longitude": lon, "accuracyMeters": 10.0, "provider": "FUSED", "capturedAt": captured}
        for i, (lat, lon, captured) in enumerate(points)
    ]}, headers=headers)
    assert resp.status_code == 200, resp.json()


class CapturingSmsProvider(MockSmsProvider):
    def __init__(self):
        super().__init__()
        self.sent = []

    async def send_dispatch(self, log, contact, message):
        self.sent.append(message)
        return await super().send_dispatch(log, contact, message)


@pytest.fixture
def capture(client):
    provider = CapturingSmsProvider()
    app.dependency_overrides[get_provider_registry_factory] = lambda: (
        lambda: ProviderRegistry(overrides={CommunicationChannelEnum.SMS: provider})
    )
    yield provider
    app.dependency_overrides.pop(get_provider_registry_factory, None)


def test_sms_contains_link_to_latest_valid_server_location(client, capture):
    headers, user = register(client, "+919400000001", "dev3e_1")
    sync(client, headers, user, "dev3e_1", "evt3e_link")  # no contacts yet → nothing sent
    upload_points(client, headers, "evt3e_link", [
        (19.00001, 73.00001, CREATED_MS + 1000),
        (19.04260, 73.02310, CREATED_MS + 30000),   # newest capture → used
        (18.99999, 72.99999, CREATED_MS + 15000),
    ])
    client.post("/api/v1/contacts", json={"name": "Mom", "phone": "9400000002"}, headers=headers)
    assert client.post("/api/v1/emergencies/evt3e_link/dispatch", headers=headers).status_code == 200

    assert capture.sent == [
        "SheGuard ALERT: +919400000001 triggered an emergency (Manual SOS) at 05:30 IST.\n"
        "Location: https://www.google.com/maps/search/?api=1&query=19.04260%2C73.02310\n"
        "Please check on them."
    ]


def test_sms_omits_location_line_when_server_has_no_location(client, capture):
    headers, user = register(client, "+919400000003", "dev3e_2")
    client.post("/api/v1/contacts", json={"name": "Mom", "phone": "9400000004"}, headers=headers)
    sync(client, headers, user, "dev3e_2", "evt3e_noloc")  # auto-dispatch, no location uploaded
    assert len(capture.sent) == 1
    assert "Location" not in capture.sent[0]
    assert "google.com" not in capture.sent[0]
    assert "Unknown" not in capture.sent[0]


def test_client_cannot_supply_location_or_url(client, capture):
    headers, user = register(client, "+919400000005", "dev3e_3")
    sync(client, headers, user, "dev3e_3", "evt3e_client")
    client.post("/api/v1/contacts", json={"name": "Mom", "phone": "9400000006"}, headers=headers)
    client.post("/api/v1/emergencies/evt3e_client/dispatch", json={
        "location_info": "https://evil.example/fake", "latitude": 1, "longitude": 2, "map_url": "https://x",
    }, headers=headers)
    assert len(capture.sent) == 1
    assert "evil" not in capture.sent[0] and "Location" not in capture.sent[0]


def test_later_location_does_not_resend_sms(client, capture):
    headers, user = register(client, "+919400000007", "dev3e_4")
    client.post("/api/v1/contacts", json={"name": "Mom", "phone": "9400000008"}, headers=headers)
    sync(client, headers, user, "dev3e_4", "evt3e_later")  # sent without location
    upload_points(client, headers, "evt3e_later", [(19.1, 73.1, CREATED_MS + 5000)])
    sync(client, headers, user, "dev3e_4", "evt3e_later")                         # ALREADY_SYNCED
    sync(client, headers, user, "dev3e_4", "evt3e_later", updated=CREATED_MS + 9000)  # UPDATED, still open
    client.post("/api/v1/emergencies/evt3e_later/dispatch", headers=headers)
    assert len(capture.sent) == 1


@pytest.mark.asyncio
async def test_dispatch_waits_briefly_for_first_location_but_never_blocks(client, db_session):
    """With a grace period and no location ever arriving, the SMS still goes out (without a link)."""
    headers, user = register(client, "+919400000009", "dev3e_5")
    sync(client, headers, user, "dev3e_5", "evt3e_grace")
    client.post("/api/v1/contacts", json={"name": "Mom", "phone": "9400000010"}, headers=headers)
    provider = CapturingSmsProvider()
    summary = await dispatch_emergency_communications(
        db_session, uuid.UUID(user), "evt3e_grace",
        provider_registry=ProviderRegistry(overrides={CommunicationChannelEnum.SMS: provider}),
        location_grace_seconds=1.0,
    )
    assert summary.attempts[0].status.value == "PROVIDER_ACCEPTED"
    assert len(provider.sent) == 1 and "Location" not in provider.sent[0]
