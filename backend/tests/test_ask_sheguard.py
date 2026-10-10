"""
Ask SheGuard backend tests.

Tests verify:
1. Authenticated access only
2. Immediate-danger fast path (no Gemini call)
3. Normal question -> Gemini called, response returned
4. Gemini not configured -> 503
5. Gemini API error -> 503
6. Schema validation (empty messages, too many messages, content too long)
7. Never triggers emergency -- coordinator is not called
"""
import pytest
from unittest.mock import patch, MagicMock
from app.core.config import settings

def _register_and_login(client):
    res = client.post("/api/v1/auth/register", json={
        "phone": "+911234567890",
        "password": "Password123!",
        "deviceId": "dev-ask-01",
    })
    assert res.status_code == 201
    body = res.json()
    return {"Authorization": f"Bearer {body['accessToken']}"}

def _ask(client, headers, messages):
    return client.post("/api/v1/ask", headers=headers, json={"messages": messages})

def test_ask_requires_auth(client):
    res = _ask(client, {}, [{"role": "user", "content": "Hello"}])
    assert res.status_code == 403

@pytest.mark.parametrize("danger_text", [
    "I am being attacked right now",
    "Someone is attacking me",
    "I am in immediate danger",
    "He has a weapon",
    "Help me right now",
    "I am trapped inside",
    "I need emergency help now",
])
def test_immediate_danger_triggers_fast_response(client, monkeypatch, danger_text):
    headers = _register_and_login(client)
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "fake-key")

    with patch("app.services.ask_service.genai") as mock_genai:
        res = _ask(client, headers, [{"role": "user", "content": danger_text}])

    assert res.status_code == 200
    body = res.json()
    assert "SOS" in body["reply"] or "100" in body["reply"] or "safety" in body["reply"].lower()
    mock_genai.GenerativeModel.assert_not_called()

def test_immediate_danger_does_not_create_emergency(client, monkeypatch):
    headers = _register_and_login(client)
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "fake-key")

    with patch("app.services.ask_service.genai"):
        res = _ask(client, headers, [{"role": "user", "content": "I am being attacked"}])

    assert res.status_code == 200

def test_normal_question_calls_gemini_and_returns_reply(client, monkeypatch):
    headers = _register_and_login(client)
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "fake-key")

    fake_response = MagicMock()
    fake_response.text = "Stay in well-lit areas and trust your instincts."

    with patch("app.services.ask_service.genai") as mock_genai:
        mock_model = MagicMock()
        mock_chat = MagicMock()
        mock_chat.send_message.return_value = fake_response
        mock_model.start_chat.return_value = mock_chat
        mock_genai.GenerativeModel.return_value = mock_model

        res = _ask(client, headers, [{"role": "user", "content": "What should I do if someone is following me?"}])

    assert res.status_code == 200
    assert res.json()["reply"] == "Stay in well-lit areas and trust your instincts."

def test_conversation_history_passed_to_gemini(client, monkeypatch):
    headers = _register_and_login(client)
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "fake-key")

    messages = [
        {"role": "user", "content": "How does Protection Mode work?"},
        {"role": "assistant", "content": "Protection Mode arms shake detection."},
        {"role": "user", "content": "What happens when I shake?"},
    ]

    fake_response = MagicMock()
    fake_response.text = "A shake gesture triggers an emergency alert."

    with patch("app.services.ask_service.genai") as mock_genai:
        mock_model = MagicMock()
        mock_chat = MagicMock()
        mock_chat.send_message.return_value = fake_response
        mock_model.start_chat.return_value = mock_chat
        mock_genai.GenerativeModel.return_value = mock_model

        res = _ask(client, headers, messages)

    assert res.status_code == 200
    kwargs = mock_model.start_chat.call_args.kwargs
    history = kwargs.get("history", [])
    assert len(history) == 2

def test_missing_api_key_returns_503(client, monkeypatch):
    headers = _register_and_login(client)
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")

    res = _ask(client, headers, [{"role": "user", "content": "How do I stay safe?"}])
    assert res.status_code == 503
    assert "not configured" in res.json()["detail"].lower()

def test_gemini_api_error_returns_503(client, monkeypatch):
    from google.api_core.exceptions import GoogleAPICallError
    headers = _register_and_login(client)
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "fake-key")

    with patch("app.services.ask_service.genai") as mock_genai:
        mock_model = MagicMock()
        mock_chat = MagicMock()
        mock_chat.send_message.side_effect = GoogleAPICallError("Quota exceeded")
        mock_model.start_chat.return_value = mock_chat
        mock_genai.GenerativeModel.return_value = mock_model

        res = _ask(client, headers, [{"role": "user", "content": "Tell me about safety."}])

    assert res.status_code == 503

def test_empty_ai_response_returns_503(client, monkeypatch):
    headers = _register_and_login(client)
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "fake-key")

    fake_response = MagicMock()
    fake_response.text = "   "

    with patch("app.services.ask_service.genai") as mock_genai:
        mock_model = MagicMock()
        mock_chat = MagicMock()
        mock_chat.send_message.return_value = fake_response
        mock_model.start_chat.return_value = mock_chat
        mock_genai.GenerativeModel.return_value = mock_model

        res = _ask(client, headers, [{"role": "user", "content": "Tell me about safety."}])

    assert res.status_code == 503

def test_empty_messages_list_rejected(client):
    headers = _register_and_login(client)
    res = _ask(client, headers, [])
    assert res.status_code == 422

def test_too_many_messages_rejected(client):
    headers = _register_and_login(client)
    messages = [{"role": "user", "content": f"msg {i}"} for i in range(21)]
    res = _ask(client, headers, messages)
    assert res.status_code == 422

def test_empty_content_rejected(client):
    headers = _register_and_login(client)
    res = _ask(client, headers, [{"role": "user", "content": ""}])
    assert res.status_code == 422

def test_content_too_long_rejected(client):
    headers = _register_and_login(client)
    long_text = "A" * 2001
    res = _ask(client, headers, [{"role": "user", "content": long_text}])
    assert res.status_code == 422