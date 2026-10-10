package com.sheguardai.app.voice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.StorageService
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

class VoiceDetectionService : Service() {

    enum class VoiceState {
        DISABLED,
        INITIALIZING,
        LISTENING,
        TRIGGER_REQUESTED,
        COOLDOWN,
        ERROR
    }

    interface VoiceTriggerListener {
        fun onVoiceTriggerDetected(payloadJson: String)
        fun onVoiceStateChanged(state: VoiceState)
    }

    companion object {
        const val CHANNEL_ID = "sheguard_voice_service_channel"
        const val NOTIFICATION_ID = 1001
        const val COOLDOWN_MS = 5000L
        /** Payload keyword for the developer simulation path (no real recognition). */
        const val TARGET_KEYWORD = "sheguard emergency"

        /**
         * What Vosk listens for: the approved phrases (see [VoicePhraseCatalog]) plus "[unk]",
         * which absorbs all other speech so it is not forced onto an approved phrase.
         */
        private val RECOGNITION_GRAMMAR: String = VoicePhraseCatalog.voskGrammarJson()

        /**
         * Minimum Vosk word confidence for every phrase word in a FINAL result.
         * Initial value; to be tuned on-device from the diagnostic logs.
         */
        const val MIN_WORD_CONFIDENCE = 0.6

        private const val TAG = "SheGuardVoice"
        private const val MODEL_ASSET_DIR = "models/vosk-model-small-en-us-0.15"
        private const val MODEL_UNPACKED_MARKER = ".unpacked"

        @Volatile
        var currentState: VoiceState = VoiceState.DISABLED
            private set

        @Volatile
        private var isRunning = false

        private val listeners = HashSet<VoiceTriggerListener>()

        fun registerListener(listener: VoiceTriggerListener) {
            synchronized(listeners) {
                listeners.add(listener)
                listener.onVoiceStateChanged(currentState)
            }
        }

        fun unregisterListener(listener: VoiceTriggerListener) {
            synchronized(listeners) {
                listeners.remove(listener)
            }
        }

        private fun notifyStateChange(state: VoiceState) {
            currentState = state
            synchronized(listeners) {
                listeners.forEach { it.onVoiceStateChanged(state) }
            }
        }

        private fun notifyTrigger(payloadJson: String) {
            synchronized(listeners) {
                listeners.forEach { it.onVoiceTriggerDetected(payloadJson) }
            }
        }

        fun isServiceRunning(): Boolean = isRunning

        fun startService(context: Context) {
            val intent = Intent(context, VoiceDetectionService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stopService(context: Context) {
            val intent = Intent(context, VoiceDetectionService::class.java)
            context.stopService(intent)
        }
    }

    private var audioRecord: AudioRecord? = null
    private var voskModel: Model? = null
    private var voskRecognizer: Recognizer? = null
    private var executorService = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    private var isRecordListening = false

    @Volatile
    private var isInCooldown = false

    private var sessionId: String = UUID.randomUUID().toString()

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        sessionId = UUID.randomUUID().toString()
        createNotificationChannel()
        startForegroundWithNotification()
        notifyStateChange(VoiceState.INITIALIZING)
        initializeAndStartAudioProcessing()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        isRecordListening = false
        isRunning = false
        stopAudioRecordAndRecognizer()
        notifyStateChange(VoiceState.DISABLED)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "SheGuard AI Voice Protection",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Runs local microphone hotword detection for SheGuard AI safety"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun startForegroundWithNotification() {
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("SheGuard AI Voice Protection Active")
            .setContentText("Continuously listening for local emergency phrase 'SheGuard Emergency'")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun initializeAndStartAudioProcessing() {
        executorService.execute {
            try {
                // Attempt loading local Vosk model from assets
                val modelPath = unpackOrGetModelPath()
                if (modelPath != null && File(modelPath).exists()) {
                    voskModel = Model(modelPath)
                    // Constrained grammar: only recognize target emergency hotword
                    voskRecognizer = Recognizer(voskModel, 16000.0f, RECOGNITION_GRAMMAR).apply {
                        // Per-word confidences in final results (needed to authorize a trigger).
                        setWords(true)
                    }
                    Log.i(TAG, "Vosk model loaded from $modelPath")
                }

                startAudioRecordLoop()
            } catch (e: Exception) {
                Log.e(TAG, "Voice detection initialization failed", e)
                notifyStateChange(VoiceState.ERROR)
            }
        }
    }

    /**
     * Vosk needs the model on the filesystem, but it ships inside the APK assets.
     * Copies it to app-private storage once; the marker file is written last, so an
     * interrupted copy is detected and redone on the next start.
     */
    private fun unpackOrGetModelPath(): String? {
        return try {
            val targetDir = File(filesDir, MODEL_ASSET_DIR)
            val marker = File(targetDir, MODEL_UNPACKED_MARKER)
            if (!marker.exists()) {
                targetDir.deleteRecursively()
                copyAssetDir(MODEL_ASSET_DIR, targetDir)
                marker.writeText(MODEL_ASSET_DIR)
                Log.i(TAG, "Vosk model unpacked to ${targetDir.absolutePath}")
            }
            targetDir.absolutePath
        } catch (e: Exception) {
            Log.e(TAG, "Vosk model unpack failed", e)
            null
        }
    }

    private fun copyAssetDir(assetPath: String, target: File) {
        val children = assets.list(assetPath).orEmpty()
        if (children.isEmpty()) {
            // A leaf: copy the file.
            target.parentFile?.mkdirs()
            assets.open(assetPath).use { input ->
                target.outputStream().use { output -> input.copyTo(output) }
            }
            return
        }
        target.mkdirs()
        for (child in children) {
            copyAssetDir("$assetPath/$child", File(target, child))
        }
    }

    private fun startAudioRecordLoop() {
        val sampleRate = 16000
        val channelConfig = AudioFormat.CHANNEL_IN_MONO
        val audioFormat = AudioFormat.ENCODING_PCM_16BIT
        val minBufferSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
        val bufferSize = Math.max(minBufferSize, 4096)

        try {
            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                sampleRate,
                channelConfig,
                audioFormat,
                bufferSize
            )

            if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                notifyStateChange(VoiceState.ERROR)
                return
            }

            audioRecord?.startRecording()
            isRecordListening = true
            notifyStateChange(VoiceState.LISTENING)

            val buffer = ByteArray(bufferSize)

            while (isRecordListening && isRunning) {
                val readBytes = audioRecord?.read(buffer, 0, buffer.size) ?: -1
                if (readBytes > 0 && voskRecognizer != null) {
                    if (voskRecognizer!!.acceptWaveForm(buffer, readBytes)) {
                        // End of an utterance: only FINAL results may authorize an SOS.
                        handleFinalResult(voskRecognizer!!.result)
                    } else {
                        // Partial hypotheses are unstable (the grammar forces them toward the
                        // phrase); they are logged for diagnostics but never trigger.
                        logPartialCandidate(voskRecognizer!!.partialResult)
                    }
                }
            }
        } catch (e: Exception) {
            notifyStateChange(VoiceState.ERROR)
        }
    }

    private val keywordMatcher = VoiceKeywordMatcher(VoicePhraseCatalog.RECOGNITION_PHRASES, MIN_WORD_CONFIDENCE)

    @Volatile
    private var partialCandidateLogged = false

    private fun handleFinalResult(jsonResult: String) {
        partialCandidateLogged = false
        if (isInCooldown) return

        try {
            val json = JSONObject(jsonResult)
            val text = json.optString("text", "").trim()
            if (text.isEmpty()) return

            val wordsJson = json.optJSONArray("result")
            val words = buildList {
                if (wordsJson != null) {
                    for (i in 0 until wordsJson.length()) {
                        val w = wordsJson.getJSONObject(i)
                        add(RecognizedWord(w.optString("word", ""), w.optDouble("conf", 0.0)))
                    }
                }
            }

            when (val decision = keywordMatcher.evaluate(words)) {
                is VoiceKeywordMatcher.Decision.Accept -> {
                    Log.i(TAG, "Emergency phrase recognized (final, minConf=${"%.2f".format(decision.confidence)}): '${decision.phrase}'")
                    handleKeywordDetected(decision.confidence, decision.phrase)
                }
                is VoiceKeywordMatcher.Decision.Reject -> {
                    // Diagnostics only (recognized text, never audio). "[unk]"-only speech is debug-level.
                    val confs = words.joinToString(" ") { "${it.word}:${"%.2f".format(it.confidence)}" }
                    if (words.any { it.word != VoicePhraseCatalog.UNKNOWN_WORD }) {
                        Log.i(TAG, "Final result rejected (${decision.reason}): '$text' [$confs]")
                    } else {
                        Log.d(TAG, "Final result rejected (${decision.reason}): '$text'")
                    }
                }
            }
        } catch (e: Exception) {
            // Safe JSON parse error suppression
        }
    }

    private fun logPartialCandidate(jsonPartial: String) {
        if (partialCandidateLogged || isInCooldown) return
        try {
            val partial = JSONObject(jsonPartial).optString("partial", "").lowercase().trim()
            // Logging only (diagnostics): partials never trigger.
            val partialPhrase = VoicePhraseCatalog.RECOGNITION_PHRASES
                .map { it.joinToString(" ") }
                .firstOrNull { partial.contains(it) }
            if (partialPhrase != null) {
                partialCandidateLogged = true
                Log.i(TAG, "Partial hypothesis contains '$partialPhrase' (ignored; waiting for final result)")
            }
        } catch (e: Exception) {
            // Safe JSON parse error suppression
        }
    }

    /**
     * Emits a voice trigger. [confidence] is the lowest word confidence from Vosk and [phrase]
     * the matched approved phrase; the developer simulation path calls this without a
     * recognition (confidence 1.0, default phrase).
     */
    fun handleKeywordDetected(confidence: Double = 1.0, phrase: String = TARGET_KEYWORD) {
        if (isInCooldown) return

        isInCooldown = true
        notifyStateChange(VoiceState.TRIGGER_REQUESTED)

        val triggerId = "vt-" + UUID.randomUUID().toString()
        val timestamp = System.currentTimeMillis()

        val payload = JSONObject().apply {
            put("triggerId", triggerId)
            put("source", "VOICE")
            put("timestamp", timestamp)
            put("keywordDetected", phrase)
            put("confidence", confidence)
            put("detectorSessionId", sessionId)

            val metadata = JSONObject().apply {
                put("modelVersion", "vosk-model-small-en-us-0.15")
                put("isBackground", true)
            }
            put("metadata", metadata)
        }

        notifyTrigger(payload.toString())

        notifyStateChange(VoiceState.COOLDOWN)

        // 5-second mandatory cooldown timer owned by SheGuard trigger layer
        mainHandler.postDelayed({
            isInCooldown = false
            if (isRunning) {
                notifyStateChange(VoiceState.LISTENING)
            }
        }, COOLDOWN_MS)
    }

    private fun stopAudioRecordAndRecognizer() {
        try {
            if (audioRecord?.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
                audioRecord?.stop()
            }
            audioRecord?.release()
            audioRecord = null

            voskRecognizer?.close()
            voskRecognizer = null

            voskModel?.close()
            voskModel = null

            executorService.shutdownNow()
        } catch (e: Exception) {
            // Ignore teardown exception
        }
    }
}
