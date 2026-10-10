package com.sheguardai.app.activation

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import kotlin.math.sqrt

/**
 * Native Android Accelerometer Shake Detector for SheGuard AI.
 *
 * Mathematical model (peak-counting policy lives in [ShakePeakAnalyzer], which is pure Kotlin
 * and unit-tested on the JVM; this class only owns the sensor lifecycle and feeds it samples):
 * 1. Android SensorManager reports acceleration in m/s² (SI units) including Earth gravity.
 * 2. Standard gravity constant: g₀ = SensorManager.GRAVITY_EARTH = 9.80665 m/s².
 * 3. Magnitude in g-units: M = sqrt(a_x² + a_y² + a_z²) / g₀
 * 4. Sampling Frequency: Throttled to ~25 Hz (SAMPLE_THROTTLE_MS = 40ms).
 *
 * See [ShakePeakAnalyzer] for the spike/peak-count/window/cooldown policy and why each of its
 * constants was chosen (deliberate-shake vs. walking/bag/pocket/vehicle-vibration false positives).
 */
class ShakeDetector(
    context: Context,
    private val onShakeDetected: () -> Unit
) : SensorEventListener {

    companion object {
        const val SAMPLE_THROTTLE_MS = 40L
    }

    private var sensorManager: SensorManager? = null
    private var accelerometer: Sensor? = null
    private var isListening = false
    private val peakAnalyzer = ShakePeakAnalyzer()
    private var lastSampleTime = 0L

    init {
        sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
        accelerometer = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    }

    fun isAvailable(): Boolean {
        return accelerometer != null
    }

    fun startListening(): Boolean {
        if (isListening) return true
        val sensor = accelerometer ?: return false
        val manager = sensorManager ?: return false

        resetState()
        val registered = manager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_GAME)
        isListening = registered
        return registered
    }

    fun stopListening() {
        if (!isListening) return
        sensorManager?.unregisterListener(this)
        isListening = false
        resetState()
    }

    fun resetState() {
        peakAnalyzer.reset()
    }

    override fun onSensorChanged(event: SensorEvent?) {
        if (!isListening || event == null) return
        if (event.sensor.type != Sensor.TYPE_ACCELEROMETER) return

        val now = System.currentTimeMillis()

        // Throttle sampling rate to ~25 Hz (40ms)
        if (now - lastSampleTime < SAMPLE_THROTTLE_MS) {
            return
        }
        lastSampleTime = now

        // Normalize m/s² raw values to g-units (division by 9.80665 m/s²)
        val ax = event.values[0] / SensorManager.GRAVITY_EARTH
        val ay = event.values[1] / SensorManager.GRAVITY_EARTH
        val az = event.values[2] / SensorManager.GRAVITY_EARTH

        val magnitude = sqrt((ax * ax + ay * ay + az * az).toDouble()).toFloat()

        if (peakAnalyzer.onMagnitude(magnitude, now)) {
            onShakeDetected()
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        // No-op for accelerometer accuracy changes
    }
}
