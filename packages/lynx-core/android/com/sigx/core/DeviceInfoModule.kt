package com.sigx.core

import android.content.Context
import android.os.Build
import android.util.DisplayMetrics
import android.view.WindowManager
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
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

    @LynxMethod
    fun getConstants(callback: Callback?) {
        val map = JavaOnlyMap()
        map.putString("platform", "android")
        map.putString("runtime", "sigx-lynx-go")
        map.putString("lynxSdkVersion", "3.6.0")
        callback?.invoke(map)
    }

    private fun getAppVersion(): String {
        return try {
            mContext.packageManager
                .getPackageInfo(mContext.packageName, 0)
                .versionName ?: "unknown"
        } catch (_: Exception) {
            "unknown"
        }
    }
}
