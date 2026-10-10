package com.sheguardai.app.location

import android.location.Location
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap

/**
 * Platform location source. Implementations: Fused (Google Play services) and the
 * framework LocationManager fallback. Nothing outside this package knows which one is in use.
 *
 * All callbacks may be invoked on the main thread. Implementations never throw; failures are
 * reported as `null` fixes (one-shot calls) or via [UpdateListener.onUpdatesFailed].
 */
interface DeviceLocationProvider {
    val name: String

    /** Cached fix from the platform, without turning on GPS. */
    fun lastKnown(callback: (Location?) -> Unit)

    /** One new fix, or null after [timeoutMs]. */
    fun current(timeoutMs: Long, callback: (Location?) -> Unit)

    fun startUpdates(intervalMs: Long, minDistanceMeters: Float, listener: UpdateListener)

    fun stopUpdates()

    interface UpdateListener {
        fun onLocation(location: Location)
        fun onUpdatesFailed(reason: String)
    }
}

/** Serializes a platform fix for the JS bridge (validated again on the JS side). */
fun Location.toFixMap(isLastKnown: Boolean): WritableMap = Arguments.createMap().apply {
    putDouble("latitude", latitude)
    putDouble("longitude", longitude)
    if (hasAccuracy()) putDouble("accuracyMeters", accuracy.toDouble())
    if (hasAltitude()) putDouble("altitudeMeters", altitude)
    if (hasSpeed()) putDouble("speedMps", speed.toDouble())
    if (hasBearing()) putDouble("headingDegrees", bearing.toDouble())
    putDouble("timestamp", time.toDouble())
    putString(
        "provider",
        when (provider) {
            "fused" -> "FUSED"
            "gps" -> "GPS"
            "network" -> "NETWORK"
            "passive" -> "PASSIVE"
            else -> "UNKNOWN"
        }
    )
    putBoolean("isLastKnown", isLastKnown)
}
