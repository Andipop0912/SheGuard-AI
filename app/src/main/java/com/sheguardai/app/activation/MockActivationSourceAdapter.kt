package com.sheguardai.app.activation

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import java.util.UUID

class MockActivationSourceAdapter : ActivationSourceAdapter {

    private val activationEvents =
        MutableSharedFlow<ActivationRequest>(
            replay = 0,
            extraBufferCapacity = 10
        )

    private var listening = false

    override fun startListening() {
        listening = true
    }

    override fun stopListening() {
        listening = false
    }

    override fun observeRequests(): Flow<ActivationRequest> {
        return activationEvents.asSharedFlow()
    }

    /**
     * Simulates a user activation event.
     */
    fun simulateActivation(
        userInitiated: Boolean = true
    ): Boolean {
        if (!listening) {
            return false
        }

        val request = ActivationRequest(
            requestId = UUID.randomUUID().toString(),
            source = ActivationSource.MOCK,
            requestedAt = System.currentTimeMillis(),
            userInitiated = userInitiated
        )

        return activationEvents.tryEmit(request)
    }
}