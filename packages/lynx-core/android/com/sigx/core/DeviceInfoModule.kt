package com.sigx.core

import android.content.Context
import android.os.Build
import android.util.Base64
import android.util.DisplayMetrics
import android.view.WindowManager
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap
import java.security.SecureRandom
import kotlin.math.roundToInt

/**
 * Device information module, hosted by core's own native module.
 * JS usage: NativeModules.SigxCore.getDeviceInfo(callback)
 */
class DeviceInfoModule(context: Context) : LynxModule(context) {

    @LynxMethod
    fun getDeviceInfo(callback: Callback?) {
        val map = JavaOnlyMap()
        map.putString("platform", "android")
        map.putString("brand", Build.BRAND)
        map.putString("model", Build.MODEL)
        map.putString("manufacturer", Build.MANUFACTURER)
        map.putString("systemName", "Android")
        map.putString("systemVersion", Build.VERSION.RELEASE)
        map.putInt("sdkVersion", Build.VERSION.SDK_INT)
        map.putString("deviceId", Build.ID)
        map.putString("appVersion", getAppVersion())
        map.putString("appPackage", mContext.packageName)

        // Screen info — report dimensions in density-independent points (dp) so
        // they're comparable with iOS (which reports points); `screenScale` is the
        // dp→physical-px multiplier. dp is rounded to an int here, so physical px
        // is only approximately Math.round(dp * scale) — exact px isn't recoverable.
        val wm = mContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(metrics)
        map.putInt("screenWidth", (metrics.widthPixels / metrics.density).roundToInt())
        map.putInt("screenHeight", (metrics.heightPixels / metrics.density).roundToInt())
        map.putDouble("screenScale", metrics.density.toDouble())

        callback?.invoke(map)
    }

    /**
     * Current app foreground/background state — seeds the JS default on the
     * rare background boot. Live transitions arrive via [AppStatePublisher]'s
     * `appStateChanged` global event.
     * JS usage: NativeModules.SigxCore.getAppState(callback)  // { state }
     */
    @LynxMethod
    fun getAppState(callback: Callback?) {
        val map = JavaOnlyMap().apply { putString("state", AppStateBus.current) }
        callback?.invoke(map)
    }

    /**
     * Runtime orientation lock (#856). The manifest `screenOrientation`
     * (from `signalx.config.ts`) is the ceiling — see [SigxOrientation].
     * JS usage: NativeModules.SigxCore.lockOrientation({ orientation }, cb)
     */
    @LynxMethod
    fun lockOrientation(params: ReadableMap?, callback: Callback?) {
        val value = params?.getString("orientation")
        val error = if (value.isNullOrEmpty()) {
            "Missing `orientation`."
        } else {
            SigxOrientation.lock(value)
        }
        callback?.invoke(resultMap(error))
    }

    /** Release the runtime lock, restoring the manifest-declared orientation. */
    @LynxMethod
    fun unlockOrientation(callback: Callback?) {
        callback?.invoke(resultMap(SigxOrientation.unlock()))
    }

    /**
     * Cryptographically secure random bytes (#1337), base64-encoded — the
     * CSPRNG the BG thread lacks (no `crypto.getRandomValues`). Sync, so JS
     * helpers like `generateState()` stay synchronous. Returns `""` for a
     * length outside 1..1024; JS treats an empty or short result as "no random
     * source" — never a weak fallback.
     * JS usage: NativeModules.SigxCore.getRandomBytes(32)  // base64 string
     */
    @LynxMethod
    fun getRandomBytes(length: Double): String {
        val n = length.toInt()
        if (length != n.toDouble() || n < 1 || n > 1024) return ""
        val bytes = ByteArray(n)
        secureRandom.nextBytes(bytes)
        return Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    /** Empty map on success; `{ error }` on failure (CONVENTIONS.md C4). */
    private fun resultMap(error: String?): JavaOnlyMap =
        JavaOnlyMap().apply { error?.let { putString("error", it) } }

    private fun getAppVersion(): String {
        return try {
            mContext.packageManager
                .getPackageInfo(mContext.packageName, 0)
                .versionName ?: "unknown"
        } catch (_: Exception) {
            "unknown"
        }
    }

    private companion object {
        /** One shared instance — `SecureRandom` is thread-safe and seeding is costly. */
        val secureRandom: SecureRandom by lazy { SecureRandom() }
    }
}
