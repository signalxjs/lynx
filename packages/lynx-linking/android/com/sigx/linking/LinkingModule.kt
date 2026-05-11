package com.sigx.linking

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import android.util.Log
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap

/**
 * Outbound deep-link bridge — JS calls these to open URLs in the system
 * handler. Inbound URLs (deep links *into* the app) are forwarded by the
 * host MainActivity to [LinkingState.handleNewIntent], which a paired
 * per-LynxView [LinkingPublisher] then forwards to JS via
 * `sendGlobalEvent("urlReceived", ...)` and `updateGlobalProps`.
 *
 * JS usage:
 *   NativeModules.Linking.openURL(urlString, callback)
 *   NativeModules.Linking.canOpenURL(urlString, callback)
 */
class LinkingModule(context: Context) : LynxModule(context) {

    @LynxMethod
    fun openURL(url: String?, callback: Callback?) {
        if (url.isNullOrEmpty()) {
            callback?.invoke(errorMap("Invalid URL"))
            return
        }
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            mContext.startActivity(intent)
            callback?.invoke(JavaOnlyMap.from(emptyMap<String, Any>()))
        } catch (e: Exception) {
            Log.e(TAG, "openURL failed: ${e.message}")
            callback?.invoke(errorMap(e.message ?: "Failed to open URL"))
        }
    }

    @LynxMethod
    fun canOpenURL(url: String?, callback: Callback?) {
        if (url.isNullOrEmpty()) {
            callback?.invoke(false)
            return
        }
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            val resolved = mContext.packageManager.resolveActivity(intent, 0)
            callback?.invoke(resolved != null)
        } catch (e: Exception) {
            callback?.invoke(false)
        }
    }

    /**
     * Sends the foreground task to the back of the activity stack — the
     * standard "user pressed back at the root" behavior on Android. We don't
     * call `Activity.finish()` because that would tear the process down and
     * a relaunch would cold-start; `moveTaskToBack(true)` keeps the JS bundle
     * warm for instant resume.
     *
     * Walks the Context chain (Module's mContext is a ContextThemeWrapper, not
     * the Activity itself) to find the hosting Activity.
     */
    @LynxMethod
    fun exitApp(callback: Callback?) {
        try {
            val activity = findActivity(mContext)
            if (activity == null) {
                callback?.invoke(errorMap("No hosting Activity found"))
                return
            }
            activity.runOnUiThread {
                activity.moveTaskToBack(true)
                callback?.invoke(JavaOnlyMap.from(emptyMap<String, Any>()))
            }
        } catch (e: Exception) {
            Log.e(TAG, "exitApp failed: ${e.message}")
            callback?.invoke(errorMap(e.message ?: "Failed to exit app"))
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

    private fun errorMap(message: String): JavaOnlyMap {
        val map = JavaOnlyMap()
        map.putString("error", message)
        return map
    }

    private companion object {
        const val TAG = "LinkingModule"
    }
}
