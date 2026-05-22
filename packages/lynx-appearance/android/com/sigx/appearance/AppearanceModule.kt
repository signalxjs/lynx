package com.sigx.appearance

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.util.Log
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap

/**
 * System-bar appearance setters + a sync getter for the current color scheme.
 * JS usage:
 *   NativeModules.Appearance.setStatusBarStyle({ "style": "light" }, callback)
 *   NativeModules.Appearance.getColorScheme(callback)
 *
 * Status-bar / nav-bar style maps to `WindowInsetsControllerCompat`:
 *   - "light" style ⇒ light icons on a dark background ⇒
 *     isAppearanceLightStatusBars = false (the FLAG_LIGHT_STATUS_BAR meaning
 *     is inverse of its name — it controls whether the *background* is light,
 *     i.e. icons go dark).
 *   - "dark" style ⇒ dark icons ⇒ isAppearanceLightStatusBars = true.
 */
class AppearanceModule(context: Context) : LynxModule(context) {

    private companion object {
        const val TAG = "AppearanceModule"
    }

    @LynxMethod
    fun setStatusBarStyle(params: ReadableMap?, callback: Callback?) {
        val style = params?.getString("style") ?: "default"
        val activity = findActivity(mContext)
        if (activity == null) {
            callback?.invoke(errorMap("No hosting Activity found"))
            return
        }
        activity.runOnUiThread {
            try {
                val controller = controller(activity)
                controller.isAppearanceLightStatusBars = style == "dark"
                callback?.invoke(okMap())
            } catch (e: Throwable) {
                Log.w(TAG, "setStatusBarStyle failed: ${e.message}")
                callback?.invoke(errorMap(e.message ?: "setStatusBarStyle failed"))
            }
        }
    }

    @LynxMethod
    fun setStatusBarBackgroundColor(params: ReadableMap?, callback: Callback?) {
        val color = params?.getString("color")
        val activity = findActivity(mContext)
        if (activity == null) {
            callback?.invoke(errorMap("No hosting Activity found"))
            return
        }
        activity.runOnUiThread {
            try {
                // Setting statusBarColor on API 35+ (Android 15) does nothing —
                // edge-to-edge is enforced and the system bar background is
                // always transparent. Callers should overlay their own
                // background view instead.
                @Suppress("DEPRECATION")
                activity.window.statusBarColor = parseColorOrTransparent(color)
                callback?.invoke(okMap())
            } catch (e: Throwable) {
                Log.w(TAG, "setStatusBarBackgroundColor failed: ${e.message}")
                callback?.invoke(errorMap(e.message ?: "setStatusBarBackgroundColor failed"))
            }
        }
    }

    @LynxMethod
    fun setNavigationBarStyle(params: ReadableMap?, callback: Callback?) {
        val style = params?.getString("style") ?: "default"
        val color = if (params?.hasKey("color") == true) params.getString("color") else null
        val activity = findActivity(mContext)
        if (activity == null) {
            callback?.invoke(errorMap("No hosting Activity found"))
            return
        }
        activity.runOnUiThread {
            try {
                val controller = controller(activity)
                controller.isAppearanceLightNavigationBars = style == "dark"
                if (color != null) {
                    @Suppress("DEPRECATION")
                    activity.window.navigationBarColor = parseColorOrTransparent(color)
                }
                callback?.invoke(okMap())
            } catch (e: Throwable) {
                Log.w(TAG, "setNavigationBarStyle failed: ${e.message}")
                callback?.invoke(errorMap(e.message ?: "setNavigationBarStyle failed"))
            }
        }
    }

    @LynxMethod
    fun getColorScheme(callback: Callback?) {
        val night = mContext.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
        val scheme = if (night == Configuration.UI_MODE_NIGHT_YES) "dark" else "light"
        val map = JavaOnlyMap()
        map.putString("colorScheme", scheme)
        callback?.invoke(map)
    }

    private fun controller(activity: Activity): WindowInsetsControllerCompat {
        // WindowCompat.getInsetsController is the public-API-version-agnostic
        // path; under the hood it uses WindowInsetsControllerCompat which
        // delegates to WindowInsetsController on R+ and the deprecated
        // SystemUiVisibility flags below.
        return WindowCompat.getInsetsController(activity.window, activity.window.decorView)
    }

    private fun parseColorOrTransparent(hex: String?): Int {
        if (hex.isNullOrBlank()) return Color.TRANSPARENT
        return try {
            Color.parseColor(hex)
        } catch (_: IllegalArgumentException) {
            Color.TRANSPARENT
        }
    }

    private fun findActivity(ctx: Context?): Activity? {
        var cur: Context? = ctx
        while (cur is ContextWrapper) {
            if (cur is Activity) return cur
            cur = cur.baseContext
        }
        return null
    }

    private fun okMap(): JavaOnlyMap {
        val m = JavaOnlyMap()
        m.putBoolean("ok", true)
        return m
    }

    private fun errorMap(message: String): JavaOnlyMap {
        val m = JavaOnlyMap()
        m.putBoolean("ok", false)
        m.putString("reason", message)
        return m
    }

    // Keep API 35+ awareness from triggering a "field never used" warning on
    // older toolchains.
    @Suppress("unused")
    private fun targetsApi35Plus(activity: Activity): Boolean =
        Build.VERSION.SDK_INT >= 35 &&
            activity.applicationInfo.targetSdkVersion >= 35
}
