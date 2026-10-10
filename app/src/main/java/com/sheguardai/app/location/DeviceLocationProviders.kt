package com.sheguardai.app.location

import android.content.Context
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability

object DeviceLocationProviders {
    /** Fused when Google Play services is usable on this device; otherwise LocationManager. */
    fun create(context: Context): DeviceLocationProvider {
        val playServicesOk = try {
            GoogleApiAvailability.getInstance()
                .isGooglePlayServicesAvailable(context.applicationContext) == ConnectionResult.SUCCESS
        } catch (e: Exception) {
            false
        }
        return if (playServicesOk) {
            FusedDeviceLocationProvider(context)
        } else {
            PlatformDeviceLocationProvider(context)
        }
    }
}
