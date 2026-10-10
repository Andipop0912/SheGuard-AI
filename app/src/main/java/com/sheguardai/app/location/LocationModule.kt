package com.sheguardai.app.location

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Address
import android.location.Geocoder
import android.location.Location
import android.location.LocationManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.Locale
import java.util.concurrent.Executors

/**
 * JS bridge for device location (SheGuardLocationModule).
 *
 * One-shot reads (last-known / current) work while the app is in use. Continuous tracking runs
 * only inside [LocationTrackingService] and only when JS asks for it during an emergency.
 */
class LocationModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LocationTrackingService.Listener {

    private val provider: DeviceLocationProvider by lazy { DeviceLocationProviders.create(reactApplicationContext) }
    private val geocodeExecutor = Executors.newSingleThreadExecutor()

    override fun getName(): String = NAME

    override fun initialize() {
        super.initialize()
        LocationTrackingService.registerListener(this)
    }

    override fun invalidate() {
        LocationTrackingService.unregisterListener(this)
        geocodeExecutor.shutdownNow()
        super.invalidate()
    }

    private fun hasLocationPermission(): Boolean {
        val ctx: Context = reactApplicationContext
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }

    @ReactMethod
    fun isLocationServicesEnabled(promise: Promise) {
        try {
            val manager = reactApplicationContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            promise.resolve(LocationManagerCompat.isLocationEnabled(manager))
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun getLastKnownLocation(promise: Promise) {
        if (!hasLocationPermission()) {
            promise.resolve(null)
            return
        }
        provider.lastKnown { location -> promise.resolve(location?.toFixMap(isLastKnown = true)) }
    }

    @ReactMethod
    fun getCurrentLocation(timeoutMs: Double, promise: Promise) {
        if (!hasLocationPermission()) {
            promise.resolve(null)
            return
        }
        provider.current(timeoutMs.toLong()) { location -> promise.resolve(location?.toFixMap(isLastKnown = false)) }
    }

    @ReactMethod
    fun startTracking(intervalMs: Double, minDistanceMeters: Double, promise: Promise) {
        if (!hasLocationPermission()) {
            promise.reject(ERROR_PERMISSION, "Location permission not granted")
            return
        }
        try {
            LocationTrackingService.start(reactApplicationContext, intervalMs.toLong(), minDistanceMeters.toFloat())
            promise.resolve(true)
        } catch (e: Exception) {
            // ForegroundServiceStartNotAllowedException (Android 12+) when started from the background.
            promise.reject(ERROR_FOREGROUND_START, e.javaClass.simpleName, e)
        }
    }

    @ReactMethod
    fun stopTracking(promise: Promise) {
        try {
            LocationTrackingService.stop(reactApplicationContext)
        } catch (e: Exception) {
            // Stopping must never fail loudly.
        }
        promise.resolve(true)
    }

    @ReactMethod
    fun isTracking(promise: Promise) {
        promise.resolve(LocationTrackingService.isRunning)
    }

    /** Best-effort address for display. Resolves null whenever no address can be determined. */
    @ReactMethod
    fun reverseGeocode(latitude: Double, longitude: Double, promise: Promise) {
        if (!Geocoder.isPresent()) {
            promise.resolve(null)
            return
        }
        val geocoder = Geocoder(reactApplicationContext, Locale.getDefault())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            geocoder.getFromLocation(latitude, longitude, 1, object : Geocoder.GeocodeListener {
                override fun onGeocode(addresses: MutableList<Address>) = promise.resolve(addresses.firstOrNull()?.format())
                override fun onError(errorMessage: String?) = promise.resolve(null)
            })
        } else {
            geocodeExecutor.execute {
                val address = try {
                    @Suppress("DEPRECATION")
                    geocoder.getFromLocation(latitude, longitude, 1)?.firstOrNull()?.format()
                } catch (e: Exception) {
                    null
                }
                promise.resolve(address)
            }
        }
    }

    private fun Address.format(): String? {
        val parts = listOfNotNull(subLocality, locality ?: subAdminArea, adminArea).distinct()
        return when {
            parts.isNotEmpty() -> parts.joinToString(", ")
            maxAddressLineIndex >= 0 -> getAddressLine(0)
            else -> null
        }
    }

    override fun onTrackingLocation(location: Location) {
        sendEvent(EVENT_LOCATION_UPDATE, location.toFixMap(isLastKnown = false))
    }

    override fun onTrackingStateChanged(state: String, reason: String?) {
        sendEvent(EVENT_TRACKING_STATE, Arguments.createMap().apply {
            putString("state", state)
            if (reason != null) putString("reason", reason)
        })
    }

    private fun sendEvent(eventName: String, params: Any?) {
        if (reactApplicationContext.hasActiveReactInstance()) {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
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

    companion object {
        const val NAME = "SheGuardLocationModule"
        const val EVENT_LOCATION_UPDATE = "LOCATION_UPDATE"
        const val EVENT_TRACKING_STATE = "LOCATION_TRACKING_STATE"
        private const val ERROR_PERMISSION = "PERMISSION_DENIED"
        private const val ERROR_FOREGROUND_START = "FOREGROUND_START_NOT_ALLOWED"
    }
}
