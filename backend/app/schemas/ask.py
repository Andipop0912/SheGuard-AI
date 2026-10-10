"""Ask SheGuard request/response schemas."""
from __future__ import annotations
from typing import List, Literal
from pydantic import BaseModel, Field

class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=2000)

class AskRequest(BaseModel):
    """A conversation turn sent from the app.

    The phone sends only message text -- never passwords, tokens, or phone numbers.
    Max 20 turns (10 user + 10 assistant) to cap context size.
    """
    messages: List[ChatMessage] = Field(..., min_length=1, max_length=20)

class AskResponse(BaseModel):
    reply: str