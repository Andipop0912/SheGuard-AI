package com.sheguardai.app.voice

/** One word of a Vosk FINAL result (requires `Recognizer.setWords(true)`). */
data class RecognizedWord(val word: String, val confidence: Double)

/**
 * Decides whether a FINAL recognition result authorizes a voice SOS.
 *
 * Rules (V2, strict whole-utterance):
 * - Only final results are evaluated; partial hypotheses never reach this class.
 * - After normalization (case, punctuation, whitespace, "sheguard" → "she guard") the WHOLE
 *   utterance must equal one approved phrase exactly. No substring/contains matching.
 * - Any "[unk]" (speech outside the grammar) or any extra word rejects the result.
 * - Every word must have Vosk confidence >= [minWordConfidence].
 *
 * Pure Kotlin, no Android dependencies, so it is unit-testable on the JVM.
 */
class VoiceKeywordMatcher(
    phrases: List<List<String>>,
    private val minWordConfidence: Double,
) {
    private val phrases: List<List<String>> = phrases.map { VoicePhraseCatalog.normalizeWords(it) }

    sealed class Decision {
        /** [phrase] is the matched approved phrase; [confidence] the lowest word confidence. */
        data class Accept(val phrase: String, val confidence: Double) : Decision()
        data class Reject(val reason: String) : Decision()
    }

    fun evaluate(words: List<RecognizedWord>): Decision {
        // Normalize per word, keeping each word's confidence (a split "sheguard" shares it).
        val normalized = words.flatMap { w ->
            VoicePhraseCatalog.normalizeWords(listOf(w.word)).map { RecognizedWord(it, w.confidence) }
        }
        if (normalized.isEmpty()) return Decision.Reject("empty")
        if (normalized.any { it.word == VoicePhraseCatalog.UNKNOWN_WORD }) {
            return Decision.Reject("contains unrecognized speech")
        }

        val spoken = normalized.map { it.word }
        val phrase = phrases.firstOrNull { it == spoken }
            ?: return Decision.Reject("not an approved phrase")

        val minConfidence = normalized.minOf { it.confidence }
        if (minConfidence < minWordConfidence) {
            return Decision.Reject("low confidence ${"%.2f".format(minConfidence)}")
        }
        return Decision.Accept(phrase.joinToString(" "), minConfidence)
    }
}
