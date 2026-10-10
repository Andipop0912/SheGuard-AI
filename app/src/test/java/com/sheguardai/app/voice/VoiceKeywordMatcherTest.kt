package com.sheguardai.app.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceKeywordMatcherTest {

    private val matcher = VoiceKeywordMatcher(VoicePhraseCatalog.RECOGNITION_PHRASES, minWordConfidence = 0.6)

    /** Builds a final result from text, one word per whitespace token, all at [conf]. */
    private fun final(text: String, conf: Double = 0.95) =
        text.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.map { RecognizedWord(it, conf) }

    private fun words(vararg pairs: Pair<String, Double>) = pairs.map { RecognizedWord(it.first, it.second) }

    private fun assertAccepted(text: String, expectedPhrase: String? = null) {
        val decision = matcher.evaluate(final(text))
        assertTrue("expected ACCEPT for '$text' but was $decision", decision is VoiceKeywordMatcher.Decision.Accept)
        if (expectedPhrase != null) {
            assertEquals(expectedPhrase, (decision as VoiceKeywordMatcher.Decision.Accept).phrase)
        }
    }

    private fun assertRejected(text: String) {
        val decision = matcher.evaluate(final(text))
        assertTrue("expected REJECT for '$text' but was $decision", decision is VoiceKeywordMatcher.Decision.Reject)
    }

    // ---------------------------------------------------------------- approved phrases

    @Test
    fun everyApprovedPhraseTriggers_inRecognitionForm() {
        for (phrase in VoicePhraseCatalog.RECOGNITION_PHRASES) {
            assertAccepted(phrase.joinToString(" "), phrase.joinToString(" "))
        }
    }

    @Test
    fun everyApprovedPhraseTriggers_asWrittenWithSheGuardAsOneWord() {
        for (phrase in VoicePhraseCatalog.APPROVED_PHRASES) {
            assertAccepted(phrase)
        }
    }

    @Test
    fun existingSheGuardEmergencyBehaviourIsIntact() {
        assertEquals(
            VoiceKeywordMatcher.Decision.Accept("she guard emergency", 0.91),
            matcher.evaluate(words("she" to 0.98, "guard" to 0.91, "emergency" to 0.99))
        )
    }

    @Test
    fun capitalizationAndPunctuationAreNormalized() {
        assertAccepted("SheGuard Emergency", "she guard emergency")
        assertAccepted("sheguard emergency", "she guard emergency")
        assertAccepted("SheGuard, Help Me", "she guard help me")
        assertAccepted("SHE GUARD I NEED HELP!", "she guard i need help")
        assertAccepted("SheGuard I’m in Danger.", "she guard i'm in danger")
        assertAccepted("SheGuard I'm in Danger", "she guard i'm in danger")
        assertAccepted("  she   guard   save   me  ", "she guard save me")
    }

    @Test
    fun similarPhrasesResolveToTheExactPhraseSpoken() {
        assertAccepted("she guard help", "she guard help")
        assertAccepted("she guard help me", "she guard help me")
        assertAccepted("she guard emergency help", "she guard emergency help")
        assertAccepted("she guard i am in danger", "she guard i am in danger")
    }

    // ---------------------------------------------------------------- strict whole-utterance

    @Test
    fun genericPhrasesWithoutSheGuardDoNotTrigger() {
        listOf("help me", "help", "i'm in danger", "i am in danger", "please help me", "save me",
            "call for help", "i need help", "emergency", "emergency help").forEach { assertRejected(it) }
    }

    @Test
    fun extraWordsDoNotTrigger() {
        assertRejected("sheguard emergency room")
        assertRejected("please don't say sheguard emergency")
        assertRejected("sheguard is an emergency app")
        assertRejected("she guard help help")
        assertRejected("she guard help me please")
        assertRejected("she guard emergency she guard emergency")
        assertRejected("hey she guard help me")
    }

    @Test
    fun unrecognizedSpeechAroundAPhraseRejectsTheWholeResult() {
        // Previously accepted (V1 allowed [unk] around the phrase); now strictly rejected.
        assertRejected("[unk] she guard emergency")
        assertRejected("she guard emergency [unk]")
        assertRejected("[unk] she guard help me [unk]")
        assertRejected("[unk]")
    }

    @Test
    fun nearMissesDoNotTrigger() {
        listOf(
            "sheguard", "she guard", "she", "guard emergency", "guard help me",
            "she guard emergence", "she guard helps", "she guard help mee",
            "she guard i need", "she guard in danger", "she guard i danger",
            "she guard call help", "she guard call for", "she guard please help",
            "she guard save", "emergency she guard", "help me she guard",
            "she guardian help", "shes guard help",
        ).forEach { assertRejected(it) }
    }

    @Test
    fun wordsOutOfOrderOrNonContiguousDoNotTrigger() {
        assertRejected("emergency she guard")
        assertRejected("she help guard")
        assertRejected("she [unk] guard emergency")
    }

    @Test
    fun emptyResultDoesNotTrigger() {
        assertTrue(matcher.evaluate(emptyList()) is VoiceKeywordMatcher.Decision.Reject)
        assertTrue(matcher.evaluate(words("" to 1.0, "  " to 1.0)) is VoiceKeywordMatcher.Decision.Reject)
    }

    // ---------------------------------------------------------------- confidence

    @Test
    fun realConfidenceIsReportedAsTheLowestWord() {
        val decision = matcher.evaluate(words("she" to 0.99, "guard" to 0.88, "help" to 0.97, "me" to 0.93))
        assertEquals(VoiceKeywordMatcher.Decision.Accept("she guard help me", 0.88), decision)
    }

    @Test
    fun anyWordBelowThresholdRejects() {
        val decision = matcher.evaluate(words("she" to 0.95, "guard" to 0.42, "emergency" to 0.97))
        assertTrue(decision is VoiceKeywordMatcher.Decision.Reject)
    }

    @Test
    fun thresholdBoundaryIsInclusive() {
        assertTrue(matcher.evaluate(final("she guard emergency", 0.6)) is VoiceKeywordMatcher.Decision.Accept)
        assertTrue(matcher.evaluate(final("she guard emergency", 0.59)) is VoiceKeywordMatcher.Decision.Reject)
    }
}
