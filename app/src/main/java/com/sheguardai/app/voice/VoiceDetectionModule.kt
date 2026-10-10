package com.sheguardai.app.voice

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class VoiceDetectionModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), VoiceDetectionService.VoiceTriggerListener {

    override fun getName(): String = "SheGuardVoiceModule"

    override fun initialize() {
        super.initialize()
        VoiceDetectionService.registerListener(this)
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        VoiceDetectionService.unregisterListener(this)
    }

    override fun onVoiceTriggerDetected(payloadJson: String) {
        val params = Arguments.createMap().apply {
            putString("payloadJson", payloadJson)
        }
        sendEvent("VOICE_TRIGGER_DETECTED", params)
    }

    override fun onVoiceStateChanged(state: VoiceDetectionService.VoiceState) {
        val params = Arguments.createMap().apply {
            putString("state", state.name)
        }
        sendEvent("VOICE_STATE_CHANGED", params)
    }

    private fun sendEvent(eventName: String, params: Any?) {
        if (reactApplicationContext.hasActiveReactInstance()) {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        }
    }

    @ReactMethod
    fun startVoiceDetection(promise: Promise) {
        try {
            VoiceDetectionService.startService(reactApplicationContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("START_SERVICE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun stopVoiceDetection(promise: Promise) {
        try {
            VoiceDetectionService.stopService(reactApplicationContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("STOP_SERVICE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun isVoiceDetectionRunning(promise: Promise) {
        promise.resolve(VoiceDetectionService.isServiceRunning())
    }

    @ReactMethod
    fun getVoiceState(promise: Promise) {
        promise.resolve(VoiceDetectionService.currentState.name)
    }

    @ReactMethod
    fun simulateKeywordTrigger(promise: Promise) {
        try {
            val serviceRunning = VoiceDetectionService.isServiceRunning()
            if (!serviceRunning) {
                VoiceDetectionService.startService(reactApplicationContext)
            }
            // Trigger simulation
            val dummyService = VoiceDetectionService()
            dummyService.handleKeywordDetected()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SIMULATION_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN NativeEventEmitter
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for RN NativeEventEmitter
    }
}
