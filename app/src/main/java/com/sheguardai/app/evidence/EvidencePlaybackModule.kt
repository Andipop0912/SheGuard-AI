package com.sheguardai.app.evidence

import android.media.MediaPlayer
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * Plays a recorded evidence file in-app (History → Incident Details → Evidence). [filePath] may
 * be a local on-device path (the normal case: the file is never deleted after a cloud upload) or
 * an http(s) signed-URL fallback for when the local copy is gone (e.g. reinstall) but the item
 * was already uploaded — MediaPlayer streams directly from either.
 *
 * One player at a time: starting a new playback or calling stop() always releases the previous
 * one first. The play() promise settles once (on completion, on error, or on stop()), mirroring
 * AskVoiceInputModule's single-shot pattern.
 */
class EvidencePlaybackModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "SheGuardEvidencePlayback"
    }

    override fun getName(): String = "SheGuardEvidencePlaybackModule"

    private var player: MediaPlayer? = null
    private var pendingPromise: Promise? = null

    @ReactMethod
    fun play(filePath: String, promise: Promise) {
        reactApplicationContext.runOnUiQueueThread {
            startPlayback(filePath, promise)
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        reactApplicationContext.runOnUiQueueThread {
            settleOnce(completed = false)
            promise.resolve(null)
        }
    }

    private fun startPlayback(filePath: String, promise: Promise) {
        releasePlayer()
        val isRemote = filePath.startsWith("http://") || filePath.startsWith("https://")
        if (!isRemote && !File(filePath).exists()) {
            promise.reject("FILE_NOT_FOUND", "Evidence file not found on this device")
            return
        }
        try {
            val mediaPlayer = MediaPlayer()
            mediaPlayer.setDataSource(filePath)
            mediaPlayer.setOnCompletionListener { settleOnce(completed = true) }
            mediaPlayer.setOnErrorListener { _, what, extra ->
                settleOnce(completed = false, errorCode = "PLAYBACK_ERROR", errorMessage = "Playback error ($what, $extra)")
                true
            }
            pendingPromise = promise
            player = mediaPlayer
            mediaPlayer.prepare()
            mediaPlayer.start()
        } catch (e: Exception) {
            Log.e(TAG, "play failed", e)
            releasePlayer()
            promise.reject("PLAY_FAILED", e.message, e)
        }
    }

    private fun settleOnce(completed: Boolean, errorCode: String? = null, errorMessage: String? = null) {
        val promise = pendingPromise
        pendingPromise = null
        releasePlayer()
        if (promise == null) return
        if (errorCode != null) {
            promise.reject(errorCode, errorMessage)
        } else {
            promise.resolve(Arguments.createMap().apply { putBoolean("completed", completed) })
        }
    }

    private fun releasePlayer() {
        try {
            player?.stop()
        } catch (e: Exception) {
            // Ignore — may not have been started
        }
        try {
            player?.release()
        } catch (e: Exception) {
            // Ignore teardown exception
        }
        player = null
    }
}
