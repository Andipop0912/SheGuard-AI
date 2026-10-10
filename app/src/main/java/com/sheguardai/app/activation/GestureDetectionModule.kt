package com.sheguardai.app.activation

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * React Native NativeModule bridge for SheGuard AI Gesture / Shake Detection.
 *
 * Exposes native ShakeDetector capabilities to JavaScript.
 *
 * Architecture:
 * Android Accelerometer
 *      ↓
 * ShakeDetector
 *      ↓
 * GestureDetectionModule
 *      ↓
 * GESTURE_TRIGGER_DETECTED
 *      ↓
 * GestureActivationAdapter.ts
 *      ↓
 * EmergencyCoordinator
 */
class GestureDetectionModule(
    reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

    private val shakeDetector: ShakeDetector by lazy { createShakeDetector() }

    @Volatile
    private var listenerCount = 0

    override fun getName(): String = NAME

    override fun initialize() {
        super.initialize()
        // Eagerly initialize detector on module setup
        shakeDetector
    }

    /**
     * Creates the single authoritative native ShakeDetector instance.
     */
    private fun createShakeDetector(): ShakeDetector {
        return ShakeDetector(reactApplicationContext) {
            onShakeDetected()
        }
    }

    /**
     * Called by ShakeDetector when a valid shake pattern is detected.
     *
     * Emits a native event to JavaScript subscribers.
     */
    private fun onShakeDetected() {
        val params = Arguments.createMap().apply {
            putString(KEY_SOURCE, VALUE_SOURCE_GESTURE)
            putDouble(KEY_TIMESTAMP, System.currentTimeMillis().toDouble())
        }

        sendEvent(EVENT_GESTURE_TRIGGER_DETECTED, params)
    }

    /**
     * Sends an event from Android native code to React Native JavaScript runtime.
     * Only emits if there are active JS listeners registered.
     */
    private fun sendEvent(
        eventName: String,
        params: WritableMap?
    ) {
        if (listenerCount <= 0 || !reactApplicationContext.hasActiveReactInstance()) {
            return
        }

        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    /**
     * Starts native shake detection listening.
     */
    @ReactMethod
    fun startGestureDetection(promise: Promise) {
        try {
            val started = shakeDetector.startListening()
            promise.resolve(started)
        } catch (e: Exception) {
            promise.reject(
                ERROR_START_GESTURE,
                e.message,
                e
            )
        }
    }

    /**
     * Stops native shake detection listening.
     */
    @ReactMethod
    fun stopGestureDetection(promise: Promise) {
        try {
            shakeDetector.stopListening()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject(
                ERROR_STOP_GESTURE,
                e.message,
                e
            )
        }
    }

    /**
     * Checks whether the physical device has a compatible accelerometer sensor.
     */
    @ReactMethod
    fun isShakeDetectorAvailable(promise: Promise) {
        try {
            promise.resolve(shakeDetector.isAvailable())
        } catch (e: Exception) {
            promise.reject(
                ERROR_SHAKE_AVAILABILITY,
                e.message,
                e
            )
        }
    }

    /**
     * Development/testing helper. Simulates a native gesture trigger event.
     */
    @ReactMethod
    fun simulateShakeTrigger(promise: Promise) {
        try {
            onShakeDetected()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject(
                ERROR_SIMULATION,
                e.message,
                e
            )
        }
    }

    /**
     * Called by NativeEventEmitter when JS registers a listener.
     */
    @ReactMethod
    fun addListener(eventName: String) {
        listenerCount++
    }

    /**
     * Called by NativeEventEmitter when JS removes listeners.
     */
    @ReactMethod
    fun removeListeners(count: Int) {
        listenerCount = maxOf(0, listenerCount - count)
    }

    /**
     * Called when the React instance is destroyed or invalidated (React Native 0.73+ / TurboModules).
     * Cleans up sensor listeners to prevent memory & hardware resource leaks.
     */
    override fun invalidate() {
        shakeDetector.stopListening()
        super.invalidate()
    }

    @Deprecated("Deprecated in React Native 0.73+, use invalidate() instead")
    override fun onCatalystInstanceDestroy() {
        invalidate()
        @Suppress("DEPRECATION")
        super.onCatalystInstanceDestroy()
    }

    companion object {
        const val NAME = "SheGuardGestureModule"
        const val EVENT_GESTURE_TRIGGER_DETECTED = "GESTURE_TRIGGER_DETECTED"

        private const val KEY_SOURCE = "source"
        private const val KEY_TIMESTAMP = "timestamp"
        private const val VALUE_SOURCE_GESTURE = "GESTURE"

        private const val ERROR_START_GESTURE = "START_GESTURE_ERROR"
        private const val ERROR_STOP_GESTURE = "STOP_GESTURE_ERROR"
        private const val ERROR_SHAKE_AVAILABILITY = "SHAKE_AVAILABILITY_ERROR"
        private const val ERROR_SIMULATION = "SIMULATION_ERROR"
    }
}