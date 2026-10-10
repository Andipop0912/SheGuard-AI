package com.sheguardai.app.emergency.model

/**
 * Source mechanism that triggered the emergency event.
 */
enum class EmergencyTriggerSource {
    MANUAL_SOS,
    VOICE,
    GESTURE,
    HARDWARE_BUTTON,
    SYSTEM
}
