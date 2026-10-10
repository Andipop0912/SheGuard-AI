package com.sheguardai.app.activation

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow

/**
 * Placeholder for future hardware-button integration.
 *
 * Do not assume that ordinary Android applications can intercept
 * every power-button or volume-button event.
 */
class HardwareButtonActivationAdapter : ActivationSourceAdapter {

    override fun startListening() {
        // Future supported hardware integration goes here.
    }

    override fun stopListening() {
        // Future cleanup goes here.
    }

    override fun observeRequests(): Flow<ActivationRequest> {
        return emptyFlow()
    }
}