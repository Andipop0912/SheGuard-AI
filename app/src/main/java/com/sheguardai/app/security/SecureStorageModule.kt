package com.sheguardai.app.security

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Small encrypted key/value store for secrets (the session refresh token).
 *
 * Values are encrypted with AES-256-GCM using a non-exportable key held in the Android Keystore,
 * and the ciphertext is kept in a private SharedPreferences file that is excluded from backup.
 * Keystore keys are never backed up, so a value restored onto another device cannot be decrypted:
 * it is then deleted and reported as absent (the user simply signs in again).
 *
 * Values are never logged.
 */
class SecureStorageModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    private val prefs: SharedPreferences by lazy {
        reactApplicationContext.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
    }

    private val lock = Any()

    @ReactMethod
    fun getItem(key: String, promise: Promise) {
        synchronized(lock) {
            val stored = prefs.getString(key, null)
            if (stored == null) {
                promise.resolve(null)
                return
            }
            try {
                promise.resolve(decrypt(stored))
            } catch (e: Exception) {
                // Undecryptable (e.g. restored from backup, key invalidated): drop it.
                prefs.edit().remove(key).commit()
                promise.resolve(null)
            }
        }
    }

    @ReactMethod
    fun setItem(key: String, value: String, promise: Promise) {
        synchronized(lock) {
            try {
                val ok = prefs.edit().putString(key, encrypt(value)).commit()
                if (ok) promise.resolve(null) else promise.reject(ERROR_CODE, "Could not write secure value")
            } catch (e: Exception) {
                promise.reject(ERROR_CODE, "Could not encrypt secure value")
            }
        }
    }

    @ReactMethod
    fun removeItem(key: String, promise: Promise) {
        synchronized(lock) {
            prefs.edit().remove(key).commit()
            promise.resolve(null)
        }
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }

    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return "v1:" + Base64.encodeToString(iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ciphertext, Base64.NO_WRAP)
    }

    private fun decrypt(stored: String): String {
        val parts = stored.split(":")
        require(parts.size == 3 && parts[0] == "v1") { "Unknown secure value format" }
        val iv = Base64.decode(parts[1], Base64.NO_WRAP)
        val ciphertext = Base64.decode(parts[2], Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        return String(cipher.doFinal(ciphertext), Charsets.UTF_8)
    }

    companion object {
        const val NAME = "SheGuardSecureStorage"
        /** Referenced by res/xml backup rules; keep in sync. */
        const val PREFS_FILE = "sheguard_secure_store"
        private const val KEY_ALIAS = "sheguard_secure_store_key_v1"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_TAG_BITS = 128
        private const val ERROR_CODE = "E_SECURE_STORAGE"
    }
}
