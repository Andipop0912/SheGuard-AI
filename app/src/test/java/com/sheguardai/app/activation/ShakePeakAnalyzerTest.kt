package com.sheguardai.app.activation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ShakePeakAnalyzerTest {

    private val analyzer = ShakePeakAnalyzer()

    private val strong = ShakePeakAnalyzer.SHAKE_MAGNITUDE_THRESHOLD + 0.3f
    private val weak = 1.3f // typical of walking with the phone in hand

    @Test
    fun `one strong spike alone never triggers`() {
        assertFalse(analyzer.onMagnitude(strong, 1_000L))
    }

    @Test
    fun `two strong spikes within the window never trigger`() {
        assertFalse(analyzer.onMagnitude(strong, 1_000L))
        assertFalse(analyzer.onMagnitude(strong, 1_200L))
    }

    @Test
    fun `three deliberate strong spikes within the window trigger exactly once`() {
        assertFalse(analyzer.onMagnitude(strong, 1_000L))
        assertFalse(analyzer.onMagnitude(strong, 1_200L))
        assertTrue(analyzer.onMagnitude(strong, 1_400L))
    }

    @Test
    fun `four or five strong spikes raise only one trigger`() {
        assertFalse(analyzer.onMagnitude(strong, 1_000L))
        assertFalse(analyzer.onMagnitude(strong, 1_200L))
        assertTrue(analyzer.onMagnitude(strong, 1_400L)) // trigger #1

        // A 4th and 5th spike land inside COOLDOWN_MS after the trigger, so neither re-triggers.
        assertFalse(analyzer.onMagnitude(strong, 1_600L))
        assertFalse(analyzer.onMagnitude(strong, 1_800L))
    }

    @Test
    fun `weak movement like normal walking never triggers no matter how many samples`() {
        var t = 1_000L
        repeat(50) {
            assertFalse(analyzer.onMagnitude(weak, t))
            t += 100L
        }
    }

    @Test
    fun `spikes faster than the minimum inter-peak interval do not count as separate peaks`() {
        // Simulates one continuous high-frequency vibration rather than 3 distinct shakes.
        assertFalse(analyzer.onMagnitude(strong, 1_000L))
        assertFalse(analyzer.onMagnitude(strong, 1_050L)) // 50ms < MIN_INTERVAL_BETWEEN_PEAKS_MS (120ms), not counted
        assertFalse(analyzer.onMagnitude(strong, 1_100L)) // still only 100ms since the first counted peak
        // Only the next sample past the minimum interval counts as the 2nd real peak.
        assertFalse(analyzer.onMagnitude(strong, 1_250L))
        assertTrue(analyzer.onMagnitude(strong, 1_400L))
    }

    @Test
    fun `peaks spread across more than one window never accumulate into a trigger`() {
        assertFalse(analyzer.onMagnitude(strong, 1_000L))
        // Second peak arrives after the detection window has already expired relative to the first.
        assertFalse(analyzer.onMagnitude(strong, 1_000L + ShakePeakAnalyzer.SHAKE_WINDOW_MS + 500L))
        // That restarts the window; a 3rd peak arriving late again never completes a sequence of 3.
        val t3 = 1_000L + ShakePeakAnalyzer.SHAKE_WINDOW_MS + 500L + ShakePeakAnalyzer.SHAKE_WINDOW_MS + 500L
        assertFalse(analyzer.onMagnitude(strong, t3))
    }

    @Test
    fun `cooldown blocks a second trigger from continued shaking`() {
        assertFalse(analyzer.onMagnitude(strong, 1_000L))
        assertFalse(analyzer.onMagnitude(strong, 1_200L))
        assertTrue(analyzer.onMagnitude(strong, 1_400L)) // trigger #1

        var t = 1_450L
        repeat(10) {
            assertFalse("continued shaking during cooldown must not re-trigger", analyzer.onMagnitude(strong, t))
            t += 150L
        }
        assertTrue("cooldown window sanity", t - 1_400L < ShakePeakAnalyzer.COOLDOWN_MS)
    }

    @Test
    fun `a fresh deliberate sequence can trigger again once cooldown has elapsed`() {
        assertFalse(analyzer.onMagnitude(strong, 1_000L))
        assertFalse(analyzer.onMagnitude(strong, 1_200L))
        assertTrue(analyzer.onMagnitude(strong, 1_400L)) // trigger #1

        val afterCooldown = 1_400L + ShakePeakAnalyzer.COOLDOWN_MS + 100L
        assertFalse(analyzer.onMagnitude(strong, afterCooldown))
        assertFalse(analyzer.onMagnitude(strong, afterCooldown + 200L))
        assertTrue(analyzer.onMagnitude(strong, afterCooldown + 400L)) // trigger #2
    }

    @Test
    fun `reset clears any partial peak sequence`() {
        assertFalse(analyzer.onMagnitude(strong, 1_000L))
        assertFalse(analyzer.onMagnitude(strong, 1_200L))
        analyzer.reset()
        // Without the reset this 3rd sample would have completed the sequence.
        assertFalse(analyzer.onMagnitude(strong, 1_400L))
    }

    @Test
    fun `excess threshold coincides with the magnitude threshold, never opening a lower path`() {
        // For a physically valid (non-negative) magnitude, excess >= 1.2g requires magnitude >=
        // 2.2g, i.e. exactly the main magnitude check — the excess path adds no lower-amplitude
        // way to reach a spike. Just below threshold must never spike, however it is reached.
        assertFalse(analyzer.onMagnitude(ShakePeakAnalyzer.SHAKE_MAGNITUDE_THRESHOLD - 0.01f, 1_000L))
    }

    @Test
    fun `magnitude just below the walking range sanity bound does not spike`() {
        assertEquals(2.2f, ShakePeakAnalyzer.SHAKE_MAGNITUDE_THRESHOLD)
        assertFalse(analyzer.onMagnitude(1.8f, 1_000L))
    }
}
