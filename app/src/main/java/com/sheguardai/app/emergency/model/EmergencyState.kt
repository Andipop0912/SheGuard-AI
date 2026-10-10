package com.sheguardai.app.emergency.model

/**
 * Represents the current lifecycle state during an emergency event.
 */
enum class EmergencyState {
    IDLE,
    TRIGGERED,
    RESPONDING,
    NOTIFYING,
    MONITORING,
    RESOLVED
}
