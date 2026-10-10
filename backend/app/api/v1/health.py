from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.dependencies import get_db

router = APIRouter()

@router.get("/health/live", summary="Liveness Probe")
def health_live():
    """Returns 200 OK if API process is running."""
    return {"status": "ok"}

@router.get("/health/ready", summary="Readiness Probe")
def health_ready(db: Session = Depends(get_db)):
    """Verifies database connectivity."""
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "database": "connected"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database connection failed"
        )
