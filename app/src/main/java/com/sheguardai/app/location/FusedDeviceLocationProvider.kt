package com.sheguardai.app.location

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.os.Looper
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import java.util.concurrent.atomic.AtomicBoolean

/** Google Play services fused provider (preferred: battery-efficient, sensor-fused). */
@SuppressLint("MissingPermission") // Callers check permission; SecurityException is still caught here.
class FusedDeviceLocationProvider(context: Context) : DeviceLocationProvider {

    override val name: String = "FUSED"

    private val client = LocationServices.getFusedLocationProviderClient(context.applicationContext)
    private var callback: LocationCallback? = null

    override fun lastKnown(callback: (Location?) -> Unit) {
        try {
            client.lastLocation
                .addOnSuccessListener { callback(it) }
                .addOnFailureListener { callback(null) }
        } catch (e: SecurityException) {
            callback(null)
        }
    }

    override fun current(timeoutMs: Long, callback: (Location?) -> Unit) {
        val delivered = AtomicBoolean(false)
        val deliver = { location: Location? -> if (delivered.compareAndSet(false, true)) callback(location) }
        try {
            val request = CurrentLocationRequest.Builder()
                .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                .setDurationMillis(timeoutMs)
                .setMaxUpdateAgeMillis(0)
                .build()
            client.getCurrentLocation(request, CancellationTokenSource().token)
                .addOnSuccessListener { deliver(it) }
                .addOnFailureListener { deliver(null) }
        } catch (e: SecurityException) {
            deliver(null)
        }
    }

    override fun startUpdates(intervalMs: Long, minDistanceMeters: Float, listener: DeviceLocationProvider.UpdateListener) {
        stopUpdates()
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
            .setMinUpdateDistanceMeters(minDistanceMeters)
            .setWaitForAccurateLocation(false)
            .build()
        val cb = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.locations.forEach { listener.onLocation(it) }
            }
        }
        try {
            client.requestLocationUpdates(request, cb, Looper.getMainLooper())
                .addOnFailureListener { listener.onUpdatesFailed("PROVIDER_ERROR") }
            callback = cb
        } catch (e: SecurityException) {
            listener.onUpdatesFailed("PERMISSION_DENIED")
        }
    }

    override fun stopUpdates() {
        callback?.let { client.removeLocationUpdates(it) }
        callback = null
    }
}
