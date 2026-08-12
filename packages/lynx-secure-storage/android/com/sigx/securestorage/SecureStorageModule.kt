package com.sigx.securestorage

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.os.Handler
import android.os.Looper
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
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

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
 * - **With `requireBiometric: true`** — a per-key Keystore **RSA pair** is
 *   created with `setUserAuthenticationRequired(true)`, which binds the
 *   requirement to the private half. `set` encrypts the value with a fresh
 *   in-memory AES-256-GCM key and wraps that key with the public half — a
 *   public-key operation, so writing never prompts, matching iOS's
 *   `SecItemAdd`. `get` authorises the RSA-decrypt `Cipher` through
 *   `BiometricPrompt.CryptoObject`, unwraps the AES key and decrypts. The
 *   wrapped key, IV and ciphertext are base64-stored in a plain
 *   `SharedPreferences` (`sigx_secure_storage_biometric_v1.xml`).
 *
 *   An auth-bound *symmetric* key cannot do this: Keystore demands a fresh
 *   authentication for every operation on one, encryption included, so the
 *   earlier single-AES-key design could never complete a write (#1027).
 */
class SecureStorageModule(context: Context) : LynxModule(context) {

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val PLAIN_PREFS = "sigx_secure_storage_v1"
        private const val BIOMETRIC_PREFS = "sigx_secure_storage_biometric_v1"
        private const val KEY_ALIAS_PREFIX = "sigx.secure-storage."
        private const val GCM_TAG_BITS = 128
        private const val AES_KEY_BITS = 256
        private const val RSA_KEY_BITS = 2048
        private const val RSA_TRANSFORMATION = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding"
        // Marker prefix on the stored blob so a format change can be detected.
        // v3 = `${base64WrappedAesKey}:${base64Iv}:${base64Ciphertext}`, wrapped
        // with the OAEP parameters above.
        //
        // v1 was a single auth-bound AES key, which could never complete a
        // write (#1027); v2 was this envelope with mismatched MGF1 digests, so
        // it could never complete a read. No shipped device holds either, and
        // a stale blob is discarded rather than migrated — with its Keystore
        // alias, because the key's authorised digests changed too and a
        // regenerated one is the only kind the new parameters accept.
        private const val BLOB_VERSION = "v3:"

        /**
         * OAEP parameters, passed explicitly on **both** sides: main digest
         * SHA-256, **MGF1 digest SHA-1**.
         *
         * The transformation name fixes only the main digest, and the two
         * providers disagree on the rest. The write wraps with a public key
         * re-imported through `KeyFactory`, so it runs on the platform
         * provider, which defaults MGF1 to SHA-256; the read runs inside
         * AndroidKeyStore, which implements MGF1 as SHA-1. Left implicit, the
         * unwrap returned garbage and the AES step failed with a tag error
         * carrying no message.
         *
         * SHA-1 rather than SHA-256 for MGF1 because that is what Keystore
         * will actually do: asking it for MGF1-SHA-256 fails at
         * `Cipher.init` with `Keystore operation failed` unless that digest is
         * separately authorised on the key, which `setMgf1Digests` only allows
         * from API 34. Both are device-caught. MGF1's digest is a mask
         * generator, not a collision-resistance boundary — SHA-1 there is the
         * OAEP default and carries no weakness for this use.
         */
        private fun oaepParams(): OAEPParameterSpec = OAEPParameterSpec(
            "SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT,
        )
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

    /**
     * Encrypt without authenticating, so `setItem` never prompts (the
     * contract iOS's `SecItemAdd` gives for free).
     *
     * An envelope, because Keystore gives no other way to have it: an
     * auth-bound **symmetric** key demands a fresh authentication for every
     * operation, encryption included, so the previous code — encrypt with
     * the same AES key the read would later decrypt with — could never
     * succeed on any device. Keystore refused the operation with
     * `KEY_USER_NOT_AUTHENTICATED`, which `doFinal` reported as
     * `IllegalBlockSizeException` (#1027).
     *
     * With an RSA pair the auth requirement binds the **private** key only:
     *
     *   1. a fresh AES-256 key, in memory, encrypts the value (AES/GCM);
     *   2. the Keystore **public** key wraps that AES key — a public-key
     *      operation, so no auth token is needed and no prompt appears;
     *   3. reading unwraps with the private key inside a `BiometricPrompt`
     *      `CryptoObject`, which is where the single prompt belongs.
     *
     * The AES key exists only for the duration of this call and is never
     * persisted — the wrapped copy in the blob is the only one that
     * survives, and it is unreadable without the biometric.
     */
    private fun writeBiometricValue(key: String, value: String) {
        val publicKey = getOrCreateBiometricKeyPair(key).public
        // Re-fetch the public key through the KeyStore: the one on the
        // generated pair carries the private key's auth requirement in its
        // parameters, so initialising a Cipher with it asks for an auth
        // token the write is trying to avoid.
        val unrestricted = KeyFactory.getInstance(publicKey.algorithm).generatePublic(
            X509EncodedKeySpec(publicKey.encoded),
        )

        val aesKey = KeyGenerator.getInstance("AES").apply { init(AES_KEY_BITS) }.generateKey()
        val payloadCipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.ENCRYPT_MODE, aesKey)
        }
        val ciphertext = payloadCipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val iv = payloadCipher.iv

        val wrapped = Cipher.getInstance(RSA_TRANSFORMATION).run {
            init(Cipher.ENCRYPT_MODE, unrestricted, oaepParams())
            doFinal(aesKey.encoded)
        }

        val blob = BLOB_VERSION +
            Base64.encodeToString(wrapped, Base64.NO_WRAP) + ":" +
            Base64.encodeToString(iv, Base64.NO_WRAP) + ":" +
            Base64.encodeToString(ciphertext, Base64.NO_WRAP)
        biometricPrefs.edit().putString(key, blob).apply()
    }

    private fun decryptBiometricValue(key: String, options: ReadableMap?, callback: Callback?) {
        val blob = biometricPrefs.getString(key, null)
        if (blob == null || !blob.startsWith(BLOB_VERSION)) {
            // A blob from an older format can never be read: discard it and
            // its key so the next `setItem` starts clean, and answer the way
            // an absent key answers.
            if (blob != null) removeBiometricValue(key)
            callback?.invoke(JavaOnlyMap().apply { putNull("value") }); return
        }
        // `wrappedAesKey : iv : ciphertext` — see writeBiometricValue. A blob
        // that doesn't parse (wrong field count, or base64 that
        // `Base64.decode` rejects with IllegalArgumentException — a truncated
        // write, a corrupted prefs file) is unreadable no matter how often it
        // is retried, so discard it and its key: the caller is told, and the
        // next `setItem` starts from a clean alias rather than inheriting the
        // wreck. Reported as an error rather than as `null`, because a value
        // *was* stored and is now gone — that is not the same as never having
        // stored one.
        val parts = blob.removePrefix(BLOB_VERSION).split(":")
        val decoded = if (parts.size == 3) {
            runCatching { parts.map { Base64.decode(it, Base64.NO_WRAP) } }.getOrNull()
        } else {
            null
        }
        if (decoded == null) {
            removeBiometricValue(key)
            callback?.invoke(
                errorPayload("corrupt biometric blob for key=$key — discarded, store it again"),
            )
            return
        }
        val (wrappedKey, iv, ciphertext) = decoded

        val privateKey = try {
            loadBiometricPrivateKey(key)
        } catch (e: Exception) {
            callback?.invoke(errorPayload("Keystore key missing or invalidated: ${e.message}"))
            return
        }
        if (privateKey == null) {
            callback?.invoke(errorPayload("Keystore key missing for key=$key")); return
        }

        // The prompt authorises this Cipher, and this Cipher unwraps the AES
        // key — so the biometric gates the key, not just the UI around it.
        val cipher: Cipher = try {
            Cipher.getInstance(RSA_TRANSFORMATION).apply {
                init(Cipher.DECRYPT_MODE, privateKey, oaepParams())
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
        val authCallback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                val authedCipher = result.cryptoObject?.cipher
                if (authedCipher == null) {
                    callback?.invoke(errorPayload("BiometricPrompt returned no Cipher"))
                    return
                }
                try {
                    // The authorised RSA cipher only unwraps the AES key; that
                    // key then decrypts the payload. Two steps, one prompt.
                    val aesKey = SecretKeySpec(authedCipher.doFinal(wrappedKey), "AES")
                    val plaintext = Cipher.getInstance("AES/GCM/NoPadding").run {
                        init(Cipher.DECRYPT_MODE, aesKey, GCMParameterSpec(GCM_TAG_BITS, iv))
                        doFinal(ciphertext)
                    }
                    callback?.invoke(JavaOnlyMap().apply {
                        putString("value", String(plaintext, Charsets.UTF_8))
                    })
                } catch (e: Exception) {
                    callback?.invoke(
                        errorPayload("Decrypt failed: ${e.message ?: e.javaClass.simpleName}"),
                    )
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
        }

        // On the main thread, like every other dialog in this repo
        // (`lynx-datetime-picker`, `lynx-file-picker`): `BiometricPrompt` is a
        // DialogFragment, so its constructor reaches into the FragmentManager
        // and the activity's LifecycleRegistry, and `authenticate` commits a
        // transaction — all main-thread-only. A `@LynxMethod` runs on the JS
        // thread, so building it here would be a lifecycle violation that
        // happens to work only until it doesn't.
        //
        // POSTED, not `activity.runOnUiThread`: that helper runs the block
        // *inline* when the caller is already on the main thread, and the
        // headline flow puts it there — `Biometric.authenticate()` and then
        // `getItem` on a gated key means this prompt is raised from the
        // previous prompt's main-thread callback. Inline meant committing a
        // transaction while FragmentManager was still executing the first
        // prompt's, which throws `IllegalStateException: FragmentManager is
        // already executing transactions` (device-caught). Posting queues it
        // behind that work in every case.
        Handler(Looper.getMainLooper()).post {
            try {
                BiometricPrompt(activity, executor, authCallback)
                    .authenticate(promptInfo, BiometricPrompt.CryptoObject(cipher))
            } catch (e: Exception) {
                callback?.invoke(errorPayload("BiometricPrompt.authenticate failed: ${e.message}"))
            }
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

    private fun loadBiometricPrivateKey(key: String): PrivateKey? {
        val keystore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        return keystore.getKey(keyAlias(key), null) as? PrivateKey
    }

    /**
     * The per-key Keystore pair. The auth requirement binds the private half,
     * so `getCertificate(...).publicKey` can wrap without a prompt while
     * unwrapping needs the biometric.
     */
    private fun getOrCreateBiometricKeyPair(key: String): KeyPair {
        val alias = keyAlias(key)
        val keystore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val existingPrivate = runCatching { keystore.getKey(alias, null) as? PrivateKey }.getOrNull()
        val existingPublic = runCatching { keystore.getCertificate(alias)?.publicKey }.getOrNull()
        if (existingPrivate != null && existingPublic != null) {
            return KeyPair(existingPublic, existingPrivate)
        }

        // The alias may still be occupied by something we can't use: an AES key
        // left by the pre-#1027 implementation, which generated it before the
        // encrypt that always failed, or half an entry from an interrupted
        // generation. Clear it first so a device carrying that residue heals on
        // the next write instead of failing forever on a key nobody can read.
        if (runCatching { keystore.containsAlias(alias) }.getOrDefault(false)) {
            runCatching { keystore.deleteEntry(alias) }
        }

        val keyGen = KeyPairGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_RSA, ANDROID_KEYSTORE,
        )
        val specBuilder = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            // SHA-1 is authorised only so the MGF1 digest above is legal on
            // the key; the OAEP main digest stays SHA-256.
            .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
            .setKeySize(RSA_KEY_BITS)
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

        keyGen.initialize(specBuilder.build())
        return keyGen.generateKeyPair()
    }

    private fun errorPayload(message: String): JavaOnlyMap =
        JavaOnlyMap().apply { putString("error", message) }
}
