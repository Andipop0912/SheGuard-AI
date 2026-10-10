from fastapi import APIRouter
from app.api.v1.health import router as health_router
from app.api.v1.auth import router as auth_router
from app.api.v1.emergencies import router as emergencies_router
from app.api.v1.contacts import router as contacts_router
from app.api.v1.communication import router as communication_router
from app.api.v1.locations import router as locations_router
from app.api.v1.ask import router as ask_router
from app.api.v1.route_safety import router as route_safety_router
from app.api.v1.evidence import router as evidence_router

api_v1_router = APIRouter()

api_v1_router.include_router(health_router)
api_v1_router.include_router(auth_router)
api_v1_router.include_router(emergencies_router)
api_v1_router.include_router(contacts_router)
api_v1_router.include_router(communication_router)
api_v1_router.include_router(locations_router)
api_v1_router.include_router(ask_router)
api_v1_router.include_router(route_safety_router)
api_v1_router.include_router(evidence_router)

