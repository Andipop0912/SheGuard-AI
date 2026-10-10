package com.sheguardai.app.activation

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID

class ActivationManagerImpl : ActivationManager {

    private val mutableActivationState =
        MutableStateFlow(ActivationState.INACTIVE)

    private val mutableActiveSessionId =
        MutableStateFlow<String?>(null)

    override val activationState: StateFlow<ActivationState> =
        mutableActivationState.asStateFlow()

    override val activeSessionId: StateFlow<String?> =
        mutableActiveSessionId.asStateFlow()

    override suspend fun handleActivation(
        request: ActivationRequest
    ): ActivationResult {

        if (!request.userInitiated) {
            mutableActivationState.value =
                ActivationState.ERROR

            return ActivationResult.Rejected(
                reason = "Activation must be user initiated."
            )
        }

        if (mutableActivationState.value == ActivationState.ACTIVE) {
            return ActivationResult.Rejected(
                reason = "Protection session is already active."
            )
        }

        mutableActivationState.value =
            ActivationState.ACTIVATION_RECEIVED

        mutableActivationState.value =
            ActivationState.CHECKING_PERMISSIONS

        /*
         * v0.1 does not access the microphone.
         *
         * Microphone permission checks will be added when
         * VoiceMonitoringService is implemented.
         */
        mutableActivationState.value =
            ActivationState.READY_TO_START

        mutableActivationState.value =
            ActivationState.STARTING

        val sessionId =
            UUID.randomUUID().toString()

        mutableActiveSessionId.value =
            sessionId

        mutableActivationState.value =
            ActivationState.ACTIVE

        return ActivationResult.Started(
            sessionId = sessionId
        )
    }

    override suspend fun stopProtection(): Result<Unit> {

        if (mutableActivationState.value != ActivationState.ACTIVE) {
            return Result.failure(
                IllegalStateException(
                    "No active protection session exists."
                )
            )
        }

        mutableActivationState.value =
            ActivationState.STOPPING

        mutableActiveSessionId.value = null

        mutableActivationState.value =
            ActivationState.INACTIVE

        return Result.success(Unit)
    }

    override fun resetToInactive() {
        mutableActiveSessionId.value = null
        mutableActivationState.value =
            ActivationState.INACTIVE
    }
}