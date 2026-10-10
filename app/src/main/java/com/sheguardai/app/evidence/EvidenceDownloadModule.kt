package com.sheguardai.app.evidence

import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Saves evidence (a locally recorded audio file, or a backend-generated PDF report fetched over
 * HTTPS) into the device's public Downloads collection via MediaStore — visible in the user's
 * Files app, independent of this app's private storage. On Android 10+ this needs no extra
 * permission (scoped storage; MediaStore owns the public Downloads collection).
 */
class EvidenceDownloadModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "SheGuardEvidenceDownload"
    }

    override fun getName(): String = "SheGuardEvidenceDownloadModule"

    @ReactMethod
    fun saveLocalFileToDownloads(sourcePath: String, fileName: String, mimeType: String, promise: Promise) {
        Thread {
            try {
                val source = File(sourcePath)
                if (!source.exists()) {
                    promise.reject("FILE_NOT_FOUND", "File not found on this device")
                    return@Thread
                }
                FileInputStream(source).use { input -> writeToDownloads(input, fileName, mimeType, promise) }
            } catch (e: Exception) {
                Log.e(TAG, "saveLocalFileToDownloads failed", e)
                promise.reject("SAVE_FAILED", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun downloadUrlToDownloads(url: String, fileName: String, mimeType: String, promise: Promise) {
        Thread {
            try {
                val connection = URL(url).openConnection() as HttpURLConnection
                connection.connectTimeout = 15_000
                connection.readTimeout = 30_000
                connection.connect()
                if (connection.responseCode !in 200..299) {
                    promise.reject("HTTP_ERROR", "HTTP ${connection.responseCode}")
                    return@Thread
                }
                connection.inputStream.use { input -> writeToDownloads(input, fileName, mimeType, promise) }
            } catch (e: Exception) {
                Log.e(TAG, "downloadUrlToDownloads failed", e)
                promise.reject("DOWNLOAD_FAILED", e.message, e)
            }
        }.start()
    }

    private fun writeToDownloads(input: InputStream, fileName: String, mimeType: String, promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = reactApplicationContext.contentResolver
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                    put(MediaStore.Downloads.MIME_TYPE, mimeType)
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                if (uri == null) {
                    promise.reject("SAVE_FAILED", "Could not create file in Downloads")
                    return
                }
                resolver.openOutputStream(uri)?.use { output -> input.copyTo(output) }
                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
            } else {
                @Suppress("DEPRECATION")
                val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                if (!downloadsDir.exists()) downloadsDir.mkdirs()
                File(downloadsDir, fileName).outputStream().use { output -> input.copyTo(output) }
            }
            promise.resolve(fileName)
        } catch (e: Exception) {
            Log.e(TAG, "writeToDownloads failed", e)
            promise.reject("SAVE_FAILED", e.message, e)
        }
    }
}
