package com.sheguardai.app.voice

/**
 * Approved production voice-SOS phrases (V2). Single source for the Vosk grammar and matching.
 *
 * Every phrase starts with "SheGuard" so ordinary conversation ("help me", "save me") cannot
 * trigger an SOS. Generic phrases are deliberately NOT included.
 *
 * "SheGuard" is not in the Vosk small-English vocabulary, so it is recognized as the two
 * in-vocabulary words "she guard"; [normalizeWords] applies the same mapping to text input.
 */
object VoicePhraseCatalog {

    /** User-facing approved phrases, exactly as specified. */
    val APPROVED_PHRASES: List<String> = listOf(
        "SheGuard Emergency",
        "SheGuard Help",
        "SheGuard Help Me",
        "SheGuard I Need Help",
        "SheGuard I'm in Danger",
        "SheGuard I Am in Danger",
        "SheGuard Call for Help",
        "SheGuard Please Help Me",
        "SheGuard Save Me",
        "SheGuard Emergency Help",
    )

    /** Recognition form of each approved phrase (normalized word lists). */
    val RECOGNITION_PHRASES: List<List<String>> = APPROVED_PHRASES.map { normalizeText(it) }

    const val UNKNOWN_WORD = "[unk]"

    /**
     * Vosk grammar: the approved phrases plus "[unk]". "[unk]" is required: without it the
     * decoder forces every sound onto the closest phrase, which caused false triggers.
     * Any result containing "[unk]" is rejected by [VoiceKeywordMatcher].
     */
    fun voskGrammarJson(): String =
        (RECOGNITION_PHRASES.map { it.joinToString(" ") } + UNKNOWN_WORD)
            .joinToString(prefix = "[", postfix = "]", separator = ", ") { "\"$it\"" }

    /** Normalizes free text into recognition words (case, punctuation, whitespace, "sheguard"). */
    fun normalizeText(text: String): List<String> =
        normalizeWords(text.split(Regex("\\s+")))

    /**
     * Normalizes individual words: lowercase, typographic apostrophes → "'", strips punctuation
     * other than in-word apostrophes, splits "sheguard" into "she guard". Keeps "[unk]" intact.
     */
    fun normalizeWords(words: List<String>): List<String> = words.flatMap { raw ->
        val lowered = raw.trim().lowercase().replace('’', '\'').replace('‘', '\'')
        when {
            lowered.isEmpty() -> emptyList()
            lowered == UNKNOWN_WORD -> listOf(UNKNOWN_WORD)
            else -> {
                val cleaned = lowered.replace(Regex("[^a-z0-9']"), "").trim('\'')
                when {
                    cleaned.isEmpty() -> emptyList()
                    cleaned == "sheguard" -> listOf("she", "guard")
                    else -> listOf(cleaned)
                }
            }
        }
    }
}
