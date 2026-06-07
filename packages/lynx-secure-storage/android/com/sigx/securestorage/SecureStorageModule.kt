package com.sigx.securestorage

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap
import com.sigx.core.SigxActivityHolder
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Encrypted KV storage backed by Android Keystore.
 *
 * JS usage: `NativeModules.SecureStorage.<method>(...)`.
 *
 * Two storage paths:
 *
 * - **Without `requireBiometric`** — values stored in
 *   `EncryptedSharedPreferences` (`sigx_secure_storage_v1.xml`). The master
 *   key is hardware-backed via Keystore; values are AES-256-GCM encrypted
 *   on disk.
 *
 * - **With `requireBiometric: true`** — a per-key Keystore alias is created
 *   with `setUserAuthenticationRequired(true)` + biometric strong
 *   authenticator. Encryption happens with a `Cipher` we initialise
 *   ourselves; the IV and ciphertext are base64-stored in a plain
 *   `SharedPreferences` (`sigx_secure_storage_biometric_v1.xml`). On
 *   `get`, the `Cipher` is initialised in DECRYPT mode and authorised
 *   through `BiometricPrompt.CryptoObject` before `doFinal`.
 */
class SecureStorageModule(context: Context) : LynxModule(context) {

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val PLAIN_PREFS = "sigx_secure_storage_v1"
        private const val BIOMETRIC_PREFS = "sigx_secure_storage_biometric_v1"
        private const val KEY_ALIAS_PREFIX = "sigx.secure-storage."
        private const val GCM_TAG_BITS = 128
        // Marker prefix on the stored blob so a future format change can be
        // detected and migrated. v1 = `${base64Iv}:${base64Ciphertext}`.
        private const val BLOB_VERSION = "v1:"
    }

    private val plainPrefs: SharedPreferences by lazy { buildEncryptedPrefs() }
    private val biometricPrefs: SharedPreferences by lazy {
        mContext.getSharedPreferences(BIOMETRIC_PREFS, Context.MODE_PRIVATE)
    }

    @LynxMethod
    fun set(key: String?, value: String?, options: ReadableMap?, callback: Callback?) {
        if (key.isNullOrEmpty()) {
            callback?.invoke(errorPayload("key is required")); return
        }
        if (value == null) {
            callback?.invoke(errorPayload("value must be a string")); return
        }
        val requireBiometric = options?.takeIf { it.hasKey("requireBiometric") }
            ?.getBoolean("requireBiometric") ?: false

        try {
            // A key transitioning between plain and biometric storage must
            // be removed from the old bucket so `get` doesn't read stale
            // data of the wrong shape.
            if (requireBiometric) {
                plainPrefs.edit().remove(key).apply()
                writeBiometricValue(key, value)
            } else {
                removeBiometricValue(key)
                plainPrefs.edit().putString(key, value).apply()
            }
            callback?.invoke(JavaOnlyMap().apply { putBoolean("ok", true) })
        } catch (e: Exception) {
            callback?.invoke(errorPayload("set failed: ${e.message ?: e.javaClass.simpleName}"))
        }
    }

    @LynxMethod
    fun get(key: String?, options: ReadableMap?, callback: Callback?) {
        if (key.isNullOrEmpty()) {
            callback?.invoke(errorPayload("key is required")); return
        }
        try {
            // Biometric items always win when both exist — we removed the
            // plain entry on `set` so this is also the only possibility.
            if (biometricPrefs.contains(key)) {
                decryptBiometricValue(key, options, callback)
                return
            }
            val value = plainPrefs.getString(key, null)
            val result = JavaOnlyMap()
            if (value == null) result.putNull("value") else result.putString("value", value)
            callback?.invoke(result)
        } catch (e: Exception) {
            callback?.invoke(errorPayload("get failed: ${e.message ?: e.javaClass.simpleName}"))
        }
    }

    @LynxMethod
    fun delete(key: String?, callback: Callback?) {
        if (key.isNullOrEmpty()) {
            callback?.invoke(errorPayload("key is required")); return
        }
        try {
            plainPrefs.edit().remove(key).apply()
            removeBiometricValue(key)
            callback?.invoke(JavaOnlyMap().apply { putBoolean("ok", true) })
        } catch (e: Exception) {
            callback?.invoke(errorPayload("delete failed: ${e.message ?: e.javaClass.simpleName}"))
        }
    }

    @LynxMethod
    fun clear(callback: Callback?) {
        try {
            plainPrefs.edit().clear().apply()
            val keystore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
            biometricPrefs.all.keys.toList().forEach { key ->
                runCatching { keystore.deleteEntry(keyAlias(key)) }
            }
            biometricPrefs.edit().clear().apply()
            callback?.invoke(JavaOnlyMap().apply { putBoolean("ok", true) })
        } catch (e: Exception) {
            callback?.invoke(errorPayload("clear failed: ${e.message ?: e.javaClass.simpleName}"))
        }
    }

    @LynxMethod
    fun hasKey(key: String?, callback: Callback?) {
        if (key.isNullOrEmpty()) {
            callback?.invoke(JavaOnlyMap().apply { putBoolean("exists", false) }); return
        }
        val exists = plainPrefs.contains(key) || biometricPrefs.contains(key)
        callback?.invoke(JavaOnlyMap().apply { putBoolean("exists", exists) })
    }

    // MARK: - EncryptedSharedPreferences (non-biometric path)

    private fun buildEncryptedPrefs(): SharedPreferences {
        val masterKey = MasterKey.Builder(mContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            mContext,
            PLAIN_PREFS,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    // MARK: - Biometric-gated path

    private fun keyAlias(key: String): String = KEY_ALIAS_PREFIX + key

    private fun writeBiometricValue(key: String, value: String) {
        val secretKey = getOrCreateBiometricKey(key)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.ENCRYPT_MODE, secretKey)
        }
        val ciphertext = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val iv = cipher.iv
        val blob = BLOB_VERSION +
            Base64.encodeToString(iv, Base64.NO_WRAP) + ":" +
            Base64.encodeToString(ciphertext, Base64.NO_WRAP)
        biometricPrefs.edit().putString(key, blob).apply()
    }

    private fun decryptBiometricValue(key: String, options: ReadableMap?, callback: Callback?) {
        val blob = biometricPrefs.getString(key, null)
        if (blob == null || !blob.startsWith(BLOB_VERSION)) {
            callback?.invoke(JavaOnlyMap().apply { putNull("value") }); return
        }
        val parts = blob.removePrefix(BLOB_VERSION).split(":")
        if (parts.size != 2) {
            callback?.invoke(errorPayload("corrupt biometric blob for key=$key")); return
        }
        val iv = Base64.decode(parts[0], Base64.NO_WRAP)
        val ciphertext = Base64.decode(parts[1], Base64.NO_WRAP)

        val secretKey = try {
            loadBiometricKey(key)
        } catch (e: Exception) {
            callback?.invoke(errorPayload("Keystore key missing or invalidated: ${e.message}"))
            return
        }
        if (secretKey == null) {
            callback?.invoke(errorPayload("Keystore key missing for key=$key")); return
        }

        val cipher: Cipher = try {
            Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(GCM_TAG_BITS, iv))
            }
        } catch (e: Exception) {
            // KeyPermanentlyInvalidatedException lives in android.security.keystore;
            // catching by superclass avoids a hard dep and keeps the error generic.
            callback?.invoke(errorPayload("Cipher init failed (key may be invalidated): ${e.message}"))
            return
        }

        val activity = SigxActivityHolder.currentFragmentActivity()
        if (activity == null) {
            callback?.invoke(errorPayload("No FragmentActivity in foreground for BiometricPrompt"))
            return
        }

        val promptOpts = options?.takeIf { it.hasKey("biometricPrompt") }?.getMap("biometricPrompt")
        val reason = promptOpts?.takeIf { it.hasKey("reason") }?.getString("reason")
            ?.takeIf { it.isNotEmpty() } ?: "Authenticate to read secure data"
        val title = promptOpts?.takeIf { it.hasKey("title") }?.getString("title")
            ?.takeIf { it.isNotEmpty() } ?: "Authenticate"

        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(reason)
            .setAllowedAuthenticators(BIOMETRIC_STRONG)
            .setNegativeButtonText("Cancel")
            .build()

        // Up-front canAuthenticate check — surfaces NO_HARDWARE, NONE_ENROLLED,
        // SECURITY_UPDATE_REQUIRED etc. as a clean error instead of letting
        // BiometricPrompt fail mid-flow. Genuine "SUCCESS but still fails" cases
        // (rare hardware bugs) are caught by the try/catch around
        // prompt.authenticate below.
        val canAuth = BiometricManager.from(mContext).canAuthenticate(BIOMETRIC_STRONG)
        if (canAuth != BiometricManager.BIOMETRIC_SUCCESS) {
            callback?.invoke(errorPayload("Biometrics unavailable (canAuthenticate=$canAuth)"))
            return
        }

        val executor = ContextCompat.getMainExecutor(mContext)
        val prompt = BiometricPrompt(
            activity, executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    val authedCipher = result.cryptoObject?.cipher
                    if (authedCipher == null) {
                        callback?.invoke(errorPayload("BiometricPrompt returned no Cipher"))
                        return
                    }
                    try {
                        val plaintext = authedCipher.doFinal(ciphertext)
                        callback?.invoke(JavaOnlyMap().apply {
                            putString("value", String(plaintext, Charsets.UTF_8))
                        })
                    } catch (e: Exception) {
                        callback?.invoke(errorPayload("Decrypt failed: ${e.message}"))
                    }
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    val mapped = when (errorCode) {
                        BiometricPrompt.ERROR_USER_CANCELED,
                        BiometricPrompt.ERROR_NEGATIVE_BUTTON -> "userCancel"
                        BiometricPrompt.ERROR_LOCKOUT,
                        BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> "biometryLockout"
                        else -> "authenticationFailed"
                    }
                    callback?.invoke(errorPayload(mapped))
                }

                override fun onAuthenticationFailed() {
                    // Single failed attempt — prompt stays up. Don't invoke.
                }
            },
        )

        try {
            prompt.authenticate(promptInfo, BiometricPrompt.CryptoObject(cipher))
        } catch (e: Exception) {
            callback?.invoke(errorPayload("BiometricPrompt.authenticate failed: ${e.message}"))
        }
    }

    private fun removeBiometricValue(key: String) {
        if (biometricPrefs.contains(key)) {
            biometricPrefs.edit().remove(key).apply()
        }
        runCatching {
            val keystore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
            if (keystore.containsAlias(keyAlias(key))) {
                keystore.deleteEntry(keyAlias(key))
            }
        }
    }

    private fun loadBiometricKey(key: String): SecretKey? {
        val keystore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        return keystore.getKey(keyAlias(key), null) as? SecretKey
    }

    private fun getOrCreateBiometricKey(key: String): SecretKey {
        val alias = keyAlias(key)
        val existing = runCatching { loadBiometricKey(key) }.getOrNull()
        if (existing != null) return existing

        val keyGen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        val specBuilder = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            specBuilder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        } else {
            // Pre-API 30 only has the legacy timeout-seconds API. `-1`
            // means "biometric required for every cryptographic operation"
            // (positive values would let one auth cover N seconds of
            // subsequent uses, which is not what we want for a credential
            // store). `0` is not valid for this setter.
            @Suppress("DEPRECATION")
            specBuilder.setUserAuthenticationValidityDurationSeconds(-1)
        }

        // `setInvalidatedByBiometricEnrollment` invalidates the key if the
        // user adds or removes a fingerprint/face — matches iOS's
        // `.biometryCurrentSet` semantic. Callers must handle the
        // "key invalidated" error and re-authenticate to re-create.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            specBuilder.setInvalidatedByBiometricEnrollment(true)
        }

        keyGen.init(specBuilder.build())
        return keyGen.generateKey()
    }

    private fun errorPayload(message: String): JavaOnlyMap =
        JavaOnlyMap().apply { putString("error", message) }
}
