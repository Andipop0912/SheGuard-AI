package com.sheguardai.app.location

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * Foreground service (type "location") that keeps receiving fixes while an emergency is open.
 * Started and stopped only by the JS emergency location controller; it never runs otherwise.
 */
class LocationTrackingService : Service() {

    interface Listener {
        fun onTrackingLocation(location: Location)
        fun onTrackingStateChanged(state: String, reason: String?)
    }

    companion object {
        private const val TAG = "SheGuardLocation"
        private const val CHANNEL_ID = "sheguard_location_tracking_channel"
        private const val NOTIFICATION_ID = 1002
        private const val EXTRA_INTERVAL_MS = "intervalMs"
        private const val EXTRA_MIN_DISTANCE_M = "minDistanceMeters"

        @Volatile
        var isRunning = false
            private set

        private val listeners = HashSet<Listener>()

        fun registerListener(listener: Listener) = synchronized(listeners) { listeners.add(listener) }
        fun unregisterListener(listener: Listener) = synchronized(listeners) { listeners.remove(listener) }

        private fun notifyLocation(location: Location) =
            synchronized(listeners) { listeners.toList() }.forEach { it.onTrackingLocation(location) }

        private fun notifyState(state: String, reason: String?) =
            synchronized(listeners) { listeners.toList() }.forEach { it.onTrackingStateChanged(state, reason) }

        /** Throws (e.g. ForegroundServiceStartNotAllowedException) when the platform refuses. */
        fun start(context: Context, intervalMs: Long, minDistanceMeters: Float) {
            val intent = Intent(context, LocationTrackingService::class.java)
                .putExtra(EXTRA_INTERVAL_MS, intervalMs)
                .putExtra(EXTRA_MIN_DISTANCE_M, minDistanceMeters)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, LocationTrackingService::class.java))
        }
    }

    private var provider: DeviceLocationProvider? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val intervalMs = intent?.getLongExtra(EXTRA_INTERVAL_MS, 15_000L) ?: 15_000L
        val minDistance = intent?.getFloatExtra(EXTRA_MIN_DISTANCE_M, 0f) ?: 0f

        try {
            startInForeground()
        } catch (e: Exception) {
            // Android 12+/14 may refuse a location foreground service (e.g. app in background,
            // permission missing). Report it; never crash the app or touch the emergency.
            Log.w(TAG, "Location foreground service refused: ${e.javaClass.simpleName}")
            notifyState("FAILED", "FOREGROUND_START_NOT_ALLOWED")
            stopSelf()
            return START_NOT_STICKY
        }

        val p = provider ?: DeviceLocationProviders.create(this).also { provider = it }
        p.startUpdates(intervalMs, minDistance, object : DeviceLocationProvider.UpdateListener {
            override fun onLocation(location: Location) = notifyLocation(location)
            override fun onUpdatesFailed(reason: String) {
                notifyState("FAILED", reason)
                stopSelf()
            }
        })
        isRunning = true
        Log.i(TAG, "Emergency location tracking started (${p.name}, every ${intervalMs}ms)")
        notifyState("STARTED", null)
        // Not sticky: if the system kills it, JS sees STOPPED and reports degraded tracking.
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        provider?.stopUpdates()
        provider = null
        if (isRunning) {
            isRunning = false
            Log.i(TAG, "Emergency location tracking stopped")
            notifyState("STOPPED", null)
        }
        super.onDestroy()
    }

    private fun startInForeground() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "SheGuard emergency location", NotificationManager.IMPORTANCE_LOW
            ).apply { description = "Shares your location while an emergency is active" }
            getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
        }
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("SheGuard emergency active")
            .setContentText("Recording your location for this emergency")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }
}
