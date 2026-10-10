package com.sheguardai.app.activation

import kotlinx.coroutines.flow.Flow

interface ActivationSourceAdapter {

    /**
     * Starts listening for activation events.
     *
     * This method must not access the microphone.
     */
    fun startListening()

    /**
     * Stops listening for activation events.
     */
    fun stopListening()

    /**
     * Emits activation requests.
     */
    fun observeRequests(): Flow<ActivationRequest>
}