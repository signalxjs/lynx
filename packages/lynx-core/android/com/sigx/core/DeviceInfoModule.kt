package com.sigx.core

import android.content.Context
import android.os.Build
import android.util.DisplayMetrics
import android.view.WindowManager
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap

/**
 * Device information module, hosted by core's own native module.
 * JS usage: NativeModules.SigxCore.getDeviceInfo(callback)
 */
class DeviceInfoModule(context: Context) : LynxModule(context) {

    @LynxMethod
    fun getDeviceInfo(callback: Callback?) {
        val map = JavaOnlyMap()
        map.putString("brand", Build.BRAND)
        map.putString("model", Build.MODEL)
        map.putString("manufacturer", Build.MANUFACTURER)
        map.putString("systemName", "Android")
        map.putString("systemVersion", Build.VERSION.RELEASE)
        map.putInt("sdkVersion", Build.VERSION.SDK_INT)
        map.putString("deviceId", Build.ID)
        map.putString("appVersion", getAppVersion())
        map.putString("appPackage", mContext.packageName)

        // Screen info
        val wm = mContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(metrics)
        map.putInt("screenWidth", metrics.widthPixels)
        map.putInt("screenHeight", metrics.heightPixels)
        map.putDouble("screenDensity", metrics.density.toDouble())

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
