import time
from typing import List, Optional, Set
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db.models.device import Device
from app.db.models.emergency_event import EmergencyEvent
from app.db.models.emergency_location import EmergencyLocation, EmergencyLocationKindEnum
from app.db.models.user import User
from app.schemas.emergency import SyncItemResultStatus
from app.schemas.location import (
    LocationBatchSyncRequest,
    LocationBatchSyncResponse,
    LocationPointResponse,
    LocationSyncResultItem,
)

EVENT_NOT_FOUND = "Emergency event not found for this account and device."


class LocationService:
    """
    Stores device-reported emergency location fixes.

    The server validates, authorizes, de-duplicates and enforces resource limits.
    Sampling frequency is the client's responsibility, so legitimate points are not thinned out.
    """

    @staticmethod
    def sync_points(
        db: Session,
        auth_user: User,
        auth_device: Device,
        event_id: str,
        req: LocationBatchSyncRequest,
    ) -> LocationBatchSyncResponse:
        # Locations may only be attached by the owning user, from the device that created the emergency.
        # 404 is also what the client gets when the emergency itself has not been synced yet (retryable).
        event = db.query(EmergencyEvent).filter(
            EmergencyEvent.event_id == event_id,
            EmergencyEvent.user_id == auth_user.id,
            EmergencyEvent.device_id == auth_device.device_id,
        ).first()
        if not event:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=EVENT_NOT_FOUND)

        stored_count = db.query(EmergencyLocation).filter(EmergencyLocation.event_id == event_id).count()
        latest_allowed = int(time.time() * 1000) + settings.LOCATION_MAX_FUTURE_SKEW_MS
        seen_in_batch: Set[str] = set()
        results: List[LocationSyncResultItem] = []

        for point in req.points:
            if point.locationId in seen_in_batch:
                results.append(LocationSyncResultItem(
                    locationId=point.locationId, status=SyncItemResultStatus.ALREADY_SYNCED,
                    message="Duplicate within batch."))
                continue
            seen_in_batch.add(point.locationId)

            existing = db.query(EmergencyLocation).filter(
                EmergencyLocation.location_id == point.locationId
            ).first()
            if existing:
                same_owner = (
                    existing.event_id == event_id
                    and existing.user_id == auth_user.id
                    and existing.device_id == auth_device.device_id
                )
                results.append(LocationSyncResultItem(
                    locationId=point.locationId,
                    status=SyncItemResultStatus.ALREADY_SYNCED if same_owner else SyncItemResultStatus.FAILED,
                    message=None if same_owner else "Location id already used.",
                ))
                continue

            if point.capturedAt > latest_allowed:
                results.append(LocationSyncResultItem(
                    locationId=point.locationId, status=SyncItemResultStatus.FAILED,
                    message="capturedAt is in the future."))
                continue

            if stored_count >= settings.LOCATION_MAX_POINTS_PER_EMERGENCY:
                results.append(LocationSyncResultItem(
                    locationId=point.locationId, status=SyncItemResultStatus.FAILED,
                    message="Location limit for this emergency reached."))
                continue

            db.add(EmergencyLocation(
                location_id=point.locationId,
                event_id=event_id,
                user_id=auth_user.id,
                device_id=auth_device.device_id,
                kind=EmergencyLocationKindEnum(point.kind.value),
                latitude=point.latitude,
                longitude=point.longitude,
                accuracy_m=point.accuracyMeters,
                altitude_m=point.altitudeMeters,
                speed_mps=point.speedMps,
                heading_deg=point.headingDegrees,
                provider=point.provider.value,
                is_last_known=point.isLastKnown,
                captured_at=point.capturedAt,
            ))
            stored_count += 1
            results.append(LocationSyncResultItem(
                locationId=point.locationId, status=SyncItemResultStatus.SYNCED))

        db.commit()
        return LocationBatchSyncResponse(eventId=event_id, results=results, storedCount=stored_count)

    @staticmethod
    def latest_point(db: Session, auth_user: User, event_id: str) -> LocationPointResponse:
        event = db.query(EmergencyEvent).filter(
            EmergencyEvent.event_id == event_id,
            EmergencyEvent.user_id == auth_user.id,
        ).first()
        if not event:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Emergency event not found.")

        latest: Optional[EmergencyLocation] = db.query(EmergencyLocation).filter(
            EmergencyLocation.event_id == event_id
        ).order_by(EmergencyLocation.captured_at.desc()).first()
        if not latest:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No location recorded for this emergency.")

        return LocationPointResponse(
            locationId=latest.location_id,
            kind=latest.kind.value,
            latitude=latest.latitude,
            longitude=latest.longitude,
            accuracyMeters=latest.accuracy_m,
            altitudeMeters=latest.altitude_m,
            speedMps=latest.speed_mps,
            headingDegrees=latest.heading_deg,
            provider=latest.provider,
            isLastKnown=latest.is_last_known,
            capturedAt=latest.captured_at,
        )
