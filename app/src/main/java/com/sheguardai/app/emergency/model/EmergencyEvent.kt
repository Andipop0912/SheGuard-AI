package com.sheguardai.app.emergency.model

/**
 * Lightweight domain model representing a core emergency event.
 *
 * Offline-first domain entity without database or network framework annotations.
 */
data class EmergencyEvent(
    val eventId: String,
    val userId: String,
    val deviceId: String,
    val triggerSource: EmergencyTriggerSource,
    val state: EmergencyState = EmergencyState.TRIGGERED,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
    val resolvedAt: Long? = null,
    val syncStatus: SyncStatus = SyncStatus.PENDING
)
