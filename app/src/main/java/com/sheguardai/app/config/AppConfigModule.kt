package com.sheguardai.app.config

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.sheguardai.app.BuildConfig

/**
 * Build-time facts JS needs. Exposes only WHETHER a Google Maps key is configured, never the key:
 * the in-app map must not be created without one (the Maps SDK aborts without a key).
 */
class AppConfigModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    override fun getConstants(): Map<String, Any> = mapOf(
        "googleMapsConfigured" to BuildConfig.GOOGLE_MAPS_CONFIGURED,
    )

    companion object {
        const val NAME = "SheGuardAppConfig"
    }
}
