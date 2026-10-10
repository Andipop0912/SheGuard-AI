package com.sheguardai.app.location

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.os.CancellationSignal
import java.util.concurrent.atomic.AtomicBoolean

/** Framework LocationManager fallback for devices without Google Play services. */
@SuppressLint("MissingPermission") // Callers check permission; SecurityException is still caught here.
class PlatformDeviceLocationProvider(context: Context) : DeviceLocationProvider {

    override val name: String = "PLATFORM"

    private val appContext = context.applicationContext
    private val manager = appContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private val mainHandler = Handler(Looper.getMainLooper())
    private val listeners = mutableListOf<LocationListener>()

    private fun enabledProviders(): List<String> =
        listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .filter { runCatching { manager.isProviderEnabled(it) }.getOrDefault(false) }

    override fun lastKnown(callback: (Location?) -> Unit) {
        val newest = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER)
            .mapNotNull { provider ->
                try {
                    manager.getLastKnownLocation(provider)
                } catch (e: Exception) {
                    null
                }
            }
            .maxByOrNull { it.time }
        callback(newest)
    }

    override fun current(timeoutMs: Long, callback: (Location?) -> Unit) {
        val provider = enabledProviders().firstOrNull()
        if (provider == null) {
            callback(null)
            return
        }
        val delivered = AtomicBoolean(false)
        val signal = CancellationSignal()
        val deliver = { location: Location? -> if (delivered.compareAndSet(false, true)) callback(location) }
        mainHandler.postDelayed({
            signal.cancel()
            deliver(null)
        }, timeoutMs)
        try {
            LocationManagerCompat.getCurrentLocation(
                manager, provider, signal, ContextCompat.getMainExecutor(appContext)
            ) { location -> deliver(location) }
        } catch (e: SecurityException) {
            deliver(null)
        }
    }

    override fun startUpdates(intervalMs: Long, minDistanceMeters: Float, listener: DeviceLocationProvider.UpdateListener) {
        stopUpdates()
        val providers = enabledProviders()
        if (providers.isEmpty()) {
            listener.onUpdatesFailed("PROVIDER_DISABLED")
            return
        }
        try {
            providers.forEach { provider ->
                val l = LocationListener { location -> listener.onLocation(location) }
                manager.requestLocationUpdates(provider, intervalMs, minDistanceMeters, l, Looper.getMainLooper())
                listeners.add(l)
            }
        } catch (e: SecurityException) {
            stopUpdates()
            listener.onUpdatesFailed("PERMISSION_DENIED")
        }
    }

    override fun stopUpdates() {
        listeners.forEach { runCatching { manager.removeUpdates(it) } }
        listeners.clear()
    }
}
