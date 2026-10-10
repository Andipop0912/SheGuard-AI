from __future__ import annotations
import logging
from typing import List

import google.generativeai as genai
from google.api_core.exceptions import GoogleAPICallError

from app.core.config import settings
from app.schemas.ask import ChatMessage

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are SheGuard AI, a personal safety assistant for women. "
    "Your role is to provide concise, practical, and empathetic safety guidance. "
    "SheGuard app capabilities: Manual SOS button, Voice trigger, Shake trigger, "
    "Protection Mode, Location tracking, Live Location, Trusted Contacts, "
    "Emergency SMS, Emergency History, Legal Help helplines, Route Safety, Ask SheGuard. "
    "CRITICAL SAFETY RULE: If the user is in IMMEDIATE danger, respond with: "
    "'YOUR SAFETY FIRST: Press the red SOS button NOW or call Police: 100, "
    "Women Helpline: 1091, Emergency: 112. Do not wait.' "
    "For other questions, keep responses under 200 words, be warm but direct."
)

IMMEDIATE_DANGER_PHRASES = [
    "being attacked", "attacking me", "immediate danger", "has a weapon",
    "help me right now", "being followed right now", "i am trapped", "i'm trapped",
    "emergency help", "someone is after me", "going to hurt me",
    "knife", "gun", "assault", "threatening me",
]

IMMEDIATE_DANGER_RESPONSE = (
    "YOUR SAFETY FIRST: If you are in immediate danger, press the red SOS button NOW "
    "or call emergency services:\n"
    "- Police: 100\n"
    "- Women's Helpline: 1091\n"
    "- Emergency: 112\n\n"
    "Do not wait -- your SOS button works even offline. "
    "Get to a safe, public place immediately if you can."
)


class AskServiceError(Exception):
    def __init__(self, message: str, status_code: int = 503):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class AskService:
    @staticmethod
    def _is_immediate_danger(text: str) -> bool:
        lower = text.lower()
        return any(phrase in lower for phrase in IMMEDIATE_DANGER_PHRASES)

    @staticmethod
    def ask(messages: List[ChatMessage]) -> str:
        last_user_text = ""
        for msg in reversed(messages):
            if msg.role == "user":
                last_user_text = msg.content
                break

        if AskService._is_immediate_danger(last_user_text):
            return IMMEDIATE_DANGER_RESPONSE

        if not settings.GEMINI_API_KEY:
            raise AskServiceError(
                "AI assistant is not configured. Please contact support.",
                status_code=503,
            )

        try:
            genai.configure(api_key=settings.GEMINI_API_KEY)
            model = genai.GenerativeModel(
                model_name="gemini-3.1-flash-lite",
                system_instruction=SYSTEM_PROMPT,
            )
            history = []
            for msg in messages[:-1]:
                history.append({
                    "role": "user" if msg.role == "user" else "model",
                    "parts": [msg.content],
                })
            chat = model.start_chat(history=history)
            response = chat.send_message(last_user_text)
            reply = response.text.strip()
            if not reply:
                raise AskServiceError("AI returned an empty response. Please try again.")
            return reply

        except AskServiceError:
            raise
        except GoogleAPICallError as exc:
            logger.warning("Gemini API error: %s", exc)
            raise AskServiceError("AI service error. Please try again.", status_code=503)
        except Exception as exc:
            logger.exception("Unexpected error in AskService: %s", exc)
            raise AskServiceError(
                "AI assistant is temporarily unavailable. Please try again.",
                status_code=503,
            )