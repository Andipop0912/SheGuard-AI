from datetime import datetime, timezone
from typing import List
from sqlalchemy.orm import Session
from app.db.models.user import User
from app.db.models.device import Device
from app.db.models.emergency_event import (
    EmergencyEvent,
    EmergencyStateEnum as DBStateEnum,
    EmergencyTriggerSourceEnum as DBTriggerEnum
)
from app.schemas.emergency import (
    EmergencyBatchSyncRequest,
    EmergencyBatchSyncResponse,
    EmergencySyncResultItem,
    SyncItemResultStatus,
    EmergencyEventDTO
)

class EmergencyService:

    @staticmethod
    def sync_batch_events(
        db: Session,
        auth_user: User,
        auth_device: Device,
        req: EmergencyBatchSyncRequest
    ) -> EmergencyBatchSyncResponse:

        results: List[EmergencySyncResultItem] = []
        now_iso = datetime.now(timezone.utc).isoformat()

        for dto in req.events:
            # 1. Device and User ID Mismatch Security Check
            if str(dto.userId) != str(auth_user.id) or dto.deviceId != auth_device.device_id:
                results.append(
                    EmergencySyncResultItem(
                        eventId=dto.eventId,
                        status=SyncItemResultStatus.FAILED,
                        serverReceivedAt=now_iso,
                        message="User ID or Device ID mismatch with authenticated session."
                    )
                )
                continue

            # 2. Query Existing Event by event_id
            existing = db.query(EmergencyEvent).filter(
                EmergencyEvent.event_id == dto.eventId
            ).first()

            # 3. Ownership Check: an existing event may only be changed by the user who
            # owns it, from the device that created it. Knowing an event_id is not enough.
            # The message is identical to "not found" so other users' events are not revealed.
            if existing and (
                existing.user_id != auth_user.id or existing.device_id != auth_device.device_id
            ):
                results.append(
                    EmergencySyncResultItem(
                        eventId=dto.eventId,
                        status=SyncItemResultStatus.FAILED,
                        serverReceivedAt=now_iso,
                        message="Emergency event not found for this account and device."
                    )
                )
                continue

            if not existing:
                # Case A: Brand New Event Insertion
                new_event = EmergencyEvent(
                    event_id=dto.eventId,
                    user_id=auth_user.id,
                    device_id=auth_device.device_id,
                    trigger_source=DBTriggerEnum(dto.triggerSource.value),
                    state=DBStateEnum(dto.state.value),
                    client_created_at=dto.createdAt,
                    client_updated_at=dto.updatedAt,
                    resolved_at=dto.resolvedAt,
                    metadata_json=dto.metadata or {},
                )
                db.add(new_event)
                results.append(
                    EmergencySyncResultItem(
                        eventId=dto.eventId,
                        status=SyncItemResultStatus.SYNCED,
                        serverReceivedAt=now_iso
                    )
                )
            else:
                # Case B: Existing Event (Idempotent Check & Lifecycle Update)
                if dto.updatedAt > existing.client_updated_at:
                    # Valid Newer Lifecycle Update
                    existing.state = DBStateEnum(dto.state.value)
                    existing.client_updated_at = dto.updatedAt
                    if dto.resolvedAt:
                        existing.resolved_at = dto.resolvedAt
                    if dto.metadata:
                        existing.metadata_json = dto.metadata

                    results.append(
                        EmergencySyncResultItem(
                            eventId=dto.eventId,
                            status=SyncItemResultStatus.UPDATED,
                            serverReceivedAt=now_iso
                        )
                    )
                elif dto.updatedAt == existing.client_updated_at:
                    # Exact Idempotent Match
                    results.append(
                        EmergencySyncResultItem(
                            eventId=dto.eventId,
                            status=SyncItemResultStatus.ALREADY_SYNCED,
                            serverReceivedAt=now_iso
                        )
                    )
                else:
                    # Stale Client Payload
                    results.append(
                        EmergencySyncResultItem(
                            eventId=dto.eventId,
                            status=SyncItemResultStatus.ALREADY_SYNCED,
                            serverReceivedAt=now_iso,
                            message="Stale client timestamp ignored."
                        )
                    )

        # Commit all batch operations in a single transaction
        db.commit()
        return EmergencyBatchSyncResponse(results=results)

    @staticmethod
    def get_user_events(db: Session, user_id: str) -> List[EmergencyEventDTO]:
        events = db.query(EmergencyEvent).filter(EmergencyEvent.user_id == user_id).order_by(EmergencyEvent.client_created_at.desc()).all()
        return [
            EmergencyEventDTO(
                eventId=e.event_id,
                userId=str(e.user_id),
                deviceId=e.device_id,
                triggerSource=e.trigger_source.value,
                state=e.state.value,
                createdAt=e.client_created_at,
                updatedAt=e.client_updated_at,
                resolvedAt=e.resolved_at,
                metadata=e.metadata_json or {}
            )
            for e in events
        ]
