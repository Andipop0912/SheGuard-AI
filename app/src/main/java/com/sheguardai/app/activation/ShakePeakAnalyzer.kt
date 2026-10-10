package com.sheguardai.app.activation

import kotlin.math.abs

/**
 * Decides whether a sequence of accelerometer magnitude samples (in g-units) adds up to a
 * genuine, deliberate shake gesture — not an isolated strong movement such as normal walking,
 * a phone bouncing inside a bag or pocket, or vehicle vibration.
 *
 * A trigger requires [REQUIRED_SHAKE_PEAKS] distinct spikes, each separated by at least
 * [MIN_INTERVAL_BETWEEN_PEAKS_MS] (so one continuous high-frequency vibration cannot be counted
 * as several peaks), all within [SHAKE_WINDOW_MS] of the first one (so the peaks must belong to
 * one continuous gesture, not casual movement spread over several seconds).
 *
 * Pure Kotlin, no Android dependencies, so it is unit-testable on the JVM.
 */
class ShakePeakAnalyzer {
    companion object {
        /**
         * A deliberate hand shake easily exceeds 2.5-3g; normal walking with a phone in hand
         * typically peaks around 1.2-1.8g. 2.2g sits above the walking range while remaining
         * comfortably reachable by a deliberate shake, giving the peak-count requirement below
         * a real amplitude floor to work with (not just a count of small bumps).
         */
        const val SHAKE_MAGNITUDE_THRESHOLD = 2.2f
        /**
         * Excess beyond 1.0g, kept equal to (SHAKE_MAGNITUDE_THRESHOLD - 1.0) on purpose: for a
         * physically valid magnitude (always >= 0), this makes the excess check coincide exactly
         * with the magnitude check rather than opening a second, lower-amplitude path to a spike.
         */
        const val SHAKE_EXCESS_THRESHOLD = 1.2f
        /**
         * Two incidental strong movements (a stumble, a bag bump) must not trigger an emergency;
         * three distinct peaks is what actually distinguishes a deliberate "shake the phone"
         * gesture from ordinary life.
         */
        const val REQUIRED_SHAKE_PEAKS = 3
        /** Prevents one continuous high-frequency vibration from being counted as multiple peaks. */
        const val MIN_INTERVAL_BETWEEN_PEAKS_MS = 120L
        /**
         * Wide enough that three deliberate peaks (naturally ~150-400ms apart) fit comfortably
         * without rushing, narrow enough that the peaks must still belong to one continuous
         * gesture rather than scattered movement over several seconds.
         */
        const val SHAKE_WINDOW_MS = 1200L
        /** Once triggered, further shaking must not raise a second emergency. */
        const val COOLDOWN_MS = 4000L
    }

    private var peakCount = 0
    private var firstPeakTime = 0L
    private var lastPeakTime = 0L
    private var cooldownUntil = 0L

    fun reset() {
        peakCount = 0
        firstPeakTime = 0L
        lastPeakTime = 0L
    }

    /**
     * Feeds one magnitude sample (in g-units, gravity already normalized out) with its
     * timestamp. Returns true exactly once, on the sample that completes a valid deliberate
     * shake; the analyzer resets itself and enters cooldown immediately after.
     */
    fun onMagnitude(magnitude: Float, nowMs: Long): Boolean {
        if (nowMs < cooldownUntil) return false

        val excess = abs(magnitude - 1.0f)
        val isSpike = magnitude >= SHAKE_MAGNITUDE_THRESHOLD || excess >= SHAKE_EXCESS_THRESHOLD
        if (!isSpike) return false

        val timeSinceFirstPeak = nowMs - firstPeakTime
        if (peakCount > 0 && timeSinceFirstPeak > SHAKE_WINDOW_MS) {
            reset()
        }

        val timeSinceLastPeak = nowMs - lastPeakTime
        if (timeSinceLastPeak < MIN_INTERVAL_BETWEEN_PEAKS_MS) return false

        if (peakCount == 0) firstPeakTime = nowMs
        lastPeakTime = nowMs
        peakCount += 1

        if (peakCount >= REQUIRED_SHAKE_PEAKS) {
            cooldownUntil = nowMs + COOLDOWN_MS
            reset()
            return true
        }
        return false
    }
}
