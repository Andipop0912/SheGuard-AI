package com.sheguardai.app.activation

enum class ActivationSource {
    MOCK,
    HARDWARE_BUTTON,
    PHONE_GESTURE,
    NOTIFICATION_ACTION,
    WIDGET,
    UNKNOWN
}

enum class ActivationState {
    INACTIVE,
    ACTIVATION_RECEIVED,
    CHECKING_PERMISSIONS,
    PERMISSION_REQUIRED,
    READY_TO_START,
    STARTING,
    ACTIVE,
    STOPPING,
    ERROR
}

data class ActivationRequest(
    val requestId: String,
    val source: ActivationSource,
    val requestedAt: Long,
    val userInitiated: Boolean
)

sealed interface ActivationResult {

    data class Started(
        val sessionId: String
    ) : ActivationResult

    data class Rejected(
        val reason: String
    ) : ActivationResult

    data class PermissionRequired(
        val permission: String
    ) : ActivationResult

    data class Failed(
        val code: String,
        val message: String
    ) : ActivationResult
}