package com.sheguardai.app.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VoicePhraseCatalogTest {

    @Test
    fun exactlyTheTenApprovedPhrases() {
        assertEquals(
            listOf(
                "she guard emergency",
                "she guard help",
                "she guard help me",
                "she guard i need help",
                "she guard i'm in danger",
                "she guard i am in danger",
                "she guard call for help",
                "she guard please help me",
                "she guard save me",
                "she guard emergency help",
            ),
            VoicePhraseCatalog.RECOGNITION_PHRASES.map { it.joinToString(" ") }
        )
    }

    @Test
    fun everyPhraseStartsWithSheGuard() {
        VoicePhraseCatalog.RECOGNITION_PHRASES.forEach { assertEquals(listOf("she", "guard"), it.take(2)) }
    }

    @Test
    fun noGenericPhraseIsInTheProductionGrammar() {
        val grammarPhrases = VoicePhraseCatalog.RECOGNITION_PHRASES.map { it.joinToString(" ") }
        listOf("help me", "i'm in danger", "please help me", "save me", "call for help").forEach {
            assertFalse("generic phrase '$it' must not be a production trigger", grammarPhrases.contains(it))
        }
    }

    @Test
    fun grammarContainsEveryPhraseAndUnkAndNothingElse() {
        val grammar = VoicePhraseCatalog.voskGrammarJson()
        assertTrue(grammar.startsWith("[") && grammar.endsWith("]"))
        VoicePhraseCatalog.RECOGNITION_PHRASES.forEach { assertTrue(grammar.contains("\"${it.joinToString(" ")}\"")) }
        assertTrue(grammar.contains("\"[unk]\""))
        assertEquals(VoicePhraseCatalog.RECOGNITION_PHRASES.size + 1, Regex("\"[^\"]+\"").findAll(grammar).count())
    }

    @Test
    fun normalization() {
        assertEquals(listOf("she", "guard", "help", "me"), VoicePhraseCatalog.normalizeText("SheGuard, Help Me!"))
        assertEquals(listOf("she", "guard", "i'm"), VoicePhraseCatalog.normalizeText("SHEGUARD I’M"))
        assertEquals(listOf("[unk]", "help"), VoicePhraseCatalog.normalizeWords(listOf("[unk]", "Help.")))
        assertEquals(emptyList<String>(), VoicePhraseCatalog.normalizeText("  ,  . "))
    }
}
