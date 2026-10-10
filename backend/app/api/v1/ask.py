"""Ask SheGuard AI chat endpoint.

POST /api/v1/ask

Requires authentication (Bearer token). Passes the user's message and conversation
history to the Gemini AI service and returns a safety-focused response.
The API key NEVER leaves the server.
"""
from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse
from app.core.dependencies import get_current_user
from app.db.models.user import User
from app.schemas.ask import AskRequest, AskResponse
from app.services.ask_service import AskService, AskServiceError

router = APIRouter(prefix="/ask", tags=["ask"])


@router.post("", response_model=AskResponse, status_code=status.HTTP_200_OK)
def ask_sheguard(
    req: AskRequest,
    current_user: User = Depends(get_current_user),
) -> AskResponse:
    """Ask SheGuard AI a safety question.

    Requires a valid access token.
    Never auto-triggers emergencies; that remains the user's SOS button.
    """
    try:
        reply = AskService.ask(req.messages)
        return AskResponse(reply=reply)
    except AskServiceError as exc:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.message},
        )
