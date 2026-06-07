package com.sigx.biometric

import android.content.Context
import android.os.Build
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap
import com.sigx.core.SigxActivityHolder

/**
 * Biometric authentication module — wraps `androidx.biometric.BiometricPrompt`.
 *
 * JS usage: `NativeModules.Biometric.<method>(...)`.
 *
 * Needs a [FragmentActivity] host (the prompt is implemented as a
 * `DialogFragment`). The Activity comes from `@sigx/lynx-core`'s shared
 * [SigxActivityHolder], auto-wired via that package's `signalx-module.json`.
 */
class BiometricModule(context: Context) : LynxModule(context) {

    @LynxMethod
    fun isAvailable(callback: Callback?) {
        val result = JavaOnlyMap()
        val manager = BiometricManager.from(mContext)
        val status = manager.canAuthenticate(BIOMETRIC_STRONG)
        val available = status == BiometricManager.BIOMETRIC_SUCCESS
        result.putBoolean("available", available)
        result.putString("type", detectBiometricType(available))
        callback?.invoke(result)
    }

    @LynxMethod
    fun authenticate(options: ReadableMap?, callback: Callback?) {
        val reason = options?.takeIf { it.hasKey("reason") }?.getString("reason").orEmpty()
        val title = options?.takeIf { it.hasKey("title") }?.getString("title")
            ?.takeIf { it.isNotEmpty() } ?: "Authenticate"
        val allowDeviceCredential = options?.takeIf { it.hasKey("allowDeviceCredential") }
            ?.getBoolean("allowDeviceCredential") ?: false

        val activity = SigxActivityHolder.currentFragmentActivity()
        if (activity == null) {
            callback?.invoke(errorPayload("noActivity", "No FragmentActivity in foreground"))
            return
        }

        // DEVICE_CREDENTIAL is only valid in `setAllowedAuthenticators`
        // alongside BIOMETRIC_STRONG on API 30+; on API 28/29 the
        // combination throws (Keystore can't enforce the integrity
        // guarantee). For those versions we fall back to the deprecated
        // `setDeviceCredentialAllowed(true)` API, which keeps the
        // PIN/passcode fallback working without crashing.
        val useLegacyDeviceCredential = allowDeviceCredential &&
            Build.VERSION.SDK_INT in 28..29

        val authenticators = when {
            !allowDeviceCredential -> BIOMETRIC_STRONG
            useLegacyDeviceCredential -> BIOMETRIC_STRONG
            else -> BIOMETRIC_STRONG or DEVICE_CREDENTIAL
        }

        val promptInfoBuilder = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(reason)
            .setAllowedAuthenticators(authenticators)

        if (useLegacyDeviceCredential) {
            // Legacy API for API 28/29 — `setDeviceCredentialAllowed(true)`
            // is mutually exclusive with `setNegativeButtonText` and with
            // DEVICE_CREDENTIAL in setAllowedAuthenticators, but it's the
            // only way to offer PIN fallback on those OS versions.
            @Suppress("DEPRECATION")
            promptInfoBuilder.setDeviceCredentialAllowed(true)
        } else if (authenticators == BIOMETRIC_STRONG) {
            // `setNegativeButtonText` is mutually exclusive with
            // DEVICE_CREDENTIAL — the OS provides its own "Use device
            // credential" affordance in that case. Only set it when
            // biometric-only with no device-credential fallback.
            promptInfoBuilder.setNegativeButtonText("Cancel")
        }

        val promptInfo = promptInfoBuilder.build()

        val executor = ContextCompat.getMainExecutor(mContext)
        val authCallback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                callback?.invoke(JavaOnlyMap().apply { putBoolean("success", true) })
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                callback?.invoke(errorPayload(mapErrorCode(errorCode), errString.toString()))
            }

            override fun onAuthenticationFailed() {
                // Called on a single rejected attempt — the prompt stays up
                // and the user can retry. Don't invoke the callback here;
                // wait for the terminal success/error.
            }
        }

        try {
            val prompt = BiometricPrompt(activity, executor, authCallback)
            prompt.authenticate(promptInfo)
        } catch (e: Exception) {
            callback?.invoke(errorPayload("unknown", e.message ?: "BiometricPrompt failed"))
        }
    }

    private fun detectBiometricType(available: Boolean): String {
        if (!available) return "none"
        val pm = mContext.packageManager
        // PackageManager features are the most reliable cross-vendor signal —
        // BiometricManager doesn't expose the underlying modality.
        if (pm.hasSystemFeature("android.hardware.fingerprint")) return "fingerprint"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            if (pm.hasSystemFeature("android.hardware.biometrics.face")) return "face"
            if (pm.hasSystemFeature("android.hardware.biometrics.iris")) return "iris"
        }
        return "fingerprint"
    }

    private fun errorPayload(errorCode: String, message: String): JavaOnlyMap {
        val map = JavaOnlyMap()
        map.putBoolean("success", false)
        map.putString("error", message)
        map.putString("errorCode", errorCode)
        return map
    }

    private fun mapErrorCode(code: Int): String = when (code) {
        BiometricPrompt.ERROR_USER_CANCELED,
        BiometricPrompt.ERROR_NEGATIVE_BUTTON -> "userCancel"
        BiometricPrompt.ERROR_CANCELED -> "systemCancel"
        BiometricPrompt.ERROR_LOCKOUT,
        BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> "biometryLockout"
        BiometricPrompt.ERROR_NO_BIOMETRICS -> "biometryNotEnrolled"
        BiometricPrompt.ERROR_HW_NOT_PRESENT,
        BiometricPrompt.ERROR_HW_UNAVAILABLE,
        BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL -> "biometryNotAvailable"
        BiometricPrompt.ERROR_TIMEOUT -> "systemCancel"
        else -> "unknown"
    }
}
