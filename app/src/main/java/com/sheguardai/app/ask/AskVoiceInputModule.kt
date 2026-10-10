package com.sheguardai.app.ask

import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * One-shot speech-to-text for the Ask SheGuard chat input. Separate from VoiceDetectionService's
 * always-on Vosk hotword loop (fixed grammar, MIC via AudioRecord): this is user-initiated,
 * free-form dictation via Android's SpeechRecognizer, and only ever runs while the user is
 * actively looking at the chat screen and has tapped the mic button.
 *
 * SpeechRecognizer must be created, started and destroyed on a thread with a Looper, so every
 * call here is dispatched onto the UI thread via runOnUiQueueThread.
 */
class AskVoiceInputModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "SheGuardAskVoice"
    }

    override fun getName(): String = "SheGuardAskVoiceModule"

    private var recognizer: SpeechRecognizer? = null

    @ReactMethod
    fun recognize(promise: Promise) {
        reactApplicationContext.runOnUiQueueThread {
            startRecognition(promise)
        }
    }

    @ReactMethod
    fun cancel() {
        reactApplicationContext.runOnUiQueueThread {
            releaseRecognizer()
        }
    }

    private fun startRecognition(promise: Promise) {
        val context = reactApplicationContext
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            promise.reject("UNAVAILABLE", "Speech recognition is not available on this device")
            return
        }
        if (recognizer != null) {
            promise.reject("ALREADY_LISTENING", "Speech recognition is already in progress")
            return
        }

        val speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context)
        recognizer = speechRecognizer
        var settled = false

        fun settleOnce(block: () -> Unit) {
            if (settled) return
            settled = true
            block()
            releaseRecognizer()
        }

        speechRecognizer.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle?) {
                val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                val text = matches?.firstOrNull()?.trim().orEmpty()
                settleOnce {
                    if (text.isEmpty()) promise.reject("NO_SPEECH", "No speech recognized") else promise.resolve(text)
                }
            }

            override fun onError(error: Int) {
                settleOnce { promise.reject("SPEECH_ERROR", "Speech recognition error code $error") }
            }

            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
        }

        try {
            speechRecognizer.startListening(intent)
        } catch (e: Exception) {
            Log.e(TAG, "startListening failed", e)
            settleOnce { promise.reject("START_FAILED", e.message, e) }
        }
    }

    private fun releaseRecognizer() {
        try {
            recognizer?.destroy()
        } catch (e: Exception) {
            // Ignore teardown exception
        }
        recognizer = null
    }
}
