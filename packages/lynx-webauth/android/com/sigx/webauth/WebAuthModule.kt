package com.sigx.webauth

import android.content.Context
import android.graphics.Color
import android.net.Uri
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap
import com.sigx.core.SigxActivityHolder

/**
 * System web-auth session module — Chrome Custom Tabs.
 *
 * JS usage: `NativeModules.WebAuth.openAuthSession({ … }, callback)`.
 *
 * Opens the authorization URL in a Custom Tab (sharing the system browser's
 * cookies/SSO). The redirect back to the app's scheme is captured via the
 * [WebAuthSession] state machine + a `@sigx/lynx-linking` interceptor; user
 * cancellation is detected on the next Activity `onResume`. See
 * [WebAuthSession] for the full flow.
 */
class WebAuthModule(context: Context) : LynxModule(context) {

    @LynxMethod
    fun openAuthSession(options: ReadableMap?, callback: Callback?) {
        val sessionId = options.string("sessionId")
        val authorizeUrl = options.string("authorizeUrl")
        val callbackScheme = options.string("callbackScheme")
        if (sessionId.isNullOrEmpty() || authorizeUrl.isNullOrEmpty() || callbackScheme.isNullOrEmpty()) {
            callback?.invoke(error("authorizeUrl and callbackScheme are required"))
            return
        }

        val uri = try {
            Uri.parse(authorizeUrl)
        } catch (e: Exception) {
            callback?.invoke(error("Invalid authorizeUrl: ${e.message}"))
            return
        }

        val activity = SigxActivityHolder.current()
        if (activity == null) {
            callback?.invoke(error("No activity in foreground"))
            return
        }

        // Register the pending session + Linking interceptor BEFORE launching.
        WebAuthSession.begin(sessionId, callbackScheme, callback)

        try {
            val builder = CustomTabsIntent.Builder()
            options.string("toolbarColor")?.let { hex ->
                val color = try {
                    Color.parseColor(hex)
                } catch (e: IllegalArgumentException) {
                    null
                }
                if (color != null) {
                    builder.setDefaultColorSchemeParams(
                        CustomTabColorSchemeParams.Builder().setToolbarColor(color).build(),
                    )
                }
            }
            val customTabsIntent = builder.build()
            options.string("preferredBrowserPackage")?.let { pkg ->
                if (pkg.isNotEmpty()) customTabsIntent.intent.setPackage(pkg)
            }
            customTabsIntent.launchUrl(activity, uri)
            WebAuthSession.markLaunched(sessionId)
        } catch (e: Exception) {
            WebAuthSession.finish(
                sessionId,
                JavaOnlyMap().apply { putString("error", "Failed to open browser: ${e.message}") },
            )
        }
    }

    @LynxMethod
    fun cancelAuthSession(options: ReadableMap?) {
        val sessionId = options.string("sessionId") ?: return
        if (sessionId.isNotEmpty()) WebAuthSession.cancel(sessionId)
    }

    private fun error(message: String): JavaOnlyMap =
        JavaOnlyMap().apply { putString("error", message) }

    private fun ReadableMap?.string(key: String): String? =
        if (this != null && hasKey(key)) getString(key) else null
}
