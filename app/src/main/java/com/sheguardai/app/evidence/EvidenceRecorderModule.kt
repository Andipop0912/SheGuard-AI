package com.sheguardai.app.evidence

import android.media.MediaRecorder
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.util.UUID

/**
 * User-initiated audio evidence recording for an open emergency.
 *
 * Uses MediaRecorder on MIC, which is a separate capture session from VoiceDetectionService's
 * AudioRecord-based hotword loop. The JS layer (evidenceStore) stops voice listening before
 * calling startRecording and restarts it after stopRecording, so only one microphone consumer
 * is ever active at a time.
 */
class EvidenceRecorderModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "SheGuardEvidence"
    }

    override fun getName(): String = "SheGuardEvidenceModule"

    private var mediaRecorder: MediaRecorder? = null
    private var currentFile: File? = null
    private var startedAtMs: Long = 0L

    @ReactMethod
    fun startRecording(eventId: String, promise: Promise) {
        if (mediaRecorder != null) {
            promise.reject("ALREADY_RECORDING", "Evidence recording is already in progress")
            return
        }
        try {
            val dir = File(reactApplicationContext.filesDir, "evidence/$eventId")
            if (!dir.exists()) dir.mkdirs()
            val file = File(dir, "evidence-${UUID.randomUUID()}.m4a")

            val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(reactApplicationContext)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            recorder.setOutputFile(file.absolutePath)
            recorder.prepare()
            recorder.start()

            mediaRecorder = recorder
            currentFile = file
            startedAtMs = System.currentTimeMillis()

            promise.resolve(file.absolutePath)
        } catch (e: Exception) {
            Log.e(TAG, "startRecording failed", e)
            releaseRecorder()
            promise.reject("START_RECORDING_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun stopRecording(promise: Promise) {
        val recorder = mediaRecorder
        val file = currentFile
        if (recorder == null || file == null) {
            promise.reject("NOT_RECORDING", "No evidence recording is in progress")
            return
        }
        try {
            recorder.stop()
            val durationMs = System.currentTimeMillis() - startedAtMs
            releaseRecorder()

            val result = Arguments.createMap().apply {
                putString("filePath", file.absolutePath)
                putDouble("durationMs", durationMs.toDouble())
            }
            promise.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "stopRecording failed", e)
            // A recorder that fails to stop cleanly never produces a usable file; discard it.
            file.delete()
            releaseRecorder()
            promise.reject("STOP_RECORDING_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun isRecording(promise: Promise) {
        promise.resolve(mediaRecorder != null)
    }

    private fun releaseRecorder() {
        try {
            mediaRecorder?.release()
        } catch (e: Exception) {
            // Ignore teardown exception
        }
        mediaRecorder = null
        currentFile = null
        startedAtMs = 0L
    }
}
