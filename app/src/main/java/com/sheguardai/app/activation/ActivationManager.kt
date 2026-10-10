package com.sheguardai.app.activation

import kotlinx.coroutines.flow.StateFlow

interface ActivationManager {

    val activationState: StateFlow<ActivationState>

    val activeSessionId: StateFlow<String?>

    suspend fun handleActivation(
        request: ActivationRequest
    ): ActivationResult

    suspend fun stopProtection(): Result<Unit>

    fun resetToInactive()
}