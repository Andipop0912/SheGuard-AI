package com.sheguardai.app.activation

import android.content.Context
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import java.util.UUID

/**
 * Native Kotlin Gesture Activation Adapter for SheGuard AI.
 * Bridges Android ShakeDetector to ActivationSourceAdapter Flow contract.
 */
class GestureActivationAdapter(
    context: Context? = null
) : ActivationSourceAdapter {

    private var shakeDetector: ShakeDetector? = null
    private val requestsFlow = MutableSharedFlow<ActivationRequest>(
        extraBufferCapacity = 10,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )

    init {
        context?.let { ctx ->
            shakeDetector = ShakeDetector(ctx) {
                handleShakeDetected()
            }
        }
    }

    fun handleShakeDetected() {
        val request = ActivationRequest(
            requestId = "req-gesture-${UUID.randomUUID()}",
            source = ActivationSource.PHONE_GESTURE,
            requestedAt = System.currentTimeMillis(),
            userInitiated = true
        )
        requestsFlow.tryEmit(request)
    }

    override fun startListening() {
        shakeDetector?.startListening()
    }

    override fun stopListening() {
        shakeDetector?.stopListening()
    }

    override fun observeRequests(): Flow<ActivationRequest> {
        return requestsFlow.asSharedFlow()
    }
}