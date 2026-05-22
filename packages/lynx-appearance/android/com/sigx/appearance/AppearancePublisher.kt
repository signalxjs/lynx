package com.sigx.appearance

import android.content.ComponentCallbacks
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import android.util.Log
import android.view.View
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.tasm.LynxView
import com.lynx.tasm.TemplateData

/**
 * Publishes the host's current system color scheme (`light` / `dark`) to JS via:
 *
 * 1. **`lynx.__globalProps.appearance`** — populated synchronously via
 *    [LynxView.updateGlobalProps] before MT first paint, so apps render the
 *    correct theme on cold start with no flash.
 *
 * 2. **`appearanceChanged` global event** — fired via [LynxView.sendGlobalEvent]
 *    after each republish. The JS `<AppearanceProvider>` subscribes via
 *    `lynx.getJSModule("GlobalEventEmitter").addListener` and updates its
 *    reactive signal so consumers (`<ThemeProvider followSystem>`) swap themes
 *    live when the user toggles dark mode in system settings.
 *
 * Lifecycle: one publisher per LynxView. [attach] is called by the autolinker
 * via `GeneratedLifecyclePublishers.attachAll(lynxView)`. We register a
 * `ComponentCallbacks2` on the application context to catch
 * `onConfigurationChanged` (the only reliable signal for runtime dark-mode
 * flips) and unregister on view detach.
 */
class AppearancePublisher(private val lynxView: LynxView) {

    private companion object {
        const val TAG = "AppearancePublisher"
        const val EVENT_NAME = "appearanceChanged"
    }

    private var lastScheme: String = ""
    private var callbacks: ComponentCallbacks? = null

    fun attach() {
        // Seed synchronously so __globalProps is populated before MT first
        // paint reads it. Reading the LynxView's own resources gives the host
        // window's effective configuration (accounts for app-level
        // android:configChanges and overrideConfiguration on the activity).
        publish(lynxView.resources.configuration)

        // Register ComponentCallbacks2 on the application so we get
        // onConfigurationChanged when the user flips system dark mode in
        // Settings → Display while the app is foregrounded. View-level
        // dispatch is unreliable: onConfigurationChanged on a View only fires
        // if the Activity declares android:configChanges, which most apps
        // don't (and shouldn't).
        val appCtx = lynxView.context.applicationContext
        val cb = object : ComponentCallbacks2 {
            override fun onConfigurationChanged(newConfig: Configuration) {
                publish(newConfig)
            }
            override fun onLowMemory() {}
            override fun onTrimMemory(level: Int) {}
        }
        appCtx.registerComponentCallbacks(cb)
        callbacks = cb

        // Detach safely when the LynxView leaves the window — covers
        // activity recreation, single-LynxView teardown during HMR, etc.
        lynxView.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(v: View) {}
            override fun onViewDetachedFromWindow(v: View) {
                detach(appCtx)
                v.removeOnAttachStateChangeListener(this)
            }
        })
    }

    private fun detach(appCtx: Context) {
        callbacks?.let {
            try {
                appCtx.unregisterComponentCallbacks(it)
            } catch (_: Throwable) {
                // unregister can throw if the callback was never registered;
                // ignore — there's nothing the host can do about it.
            }
            callbacks = null
        }
    }

    private fun publish(config: Configuration) {
        val night = config.uiMode and Configuration.UI_MODE_NIGHT_MASK
        val scheme = if (night == Configuration.UI_MODE_NIGHT_YES) "dark" else "light"
        if (scheme == lastScheme) return
        lastScheme = scheme

        val map: Map<String, Any> = mapOf("colorScheme" to scheme)

        try {
            // Channel 1: __globalProps — sync MT read at first paint.
            lynxView.updateGlobalProps(TemplateData.fromMap(mapOf("appearance" to map)))

            // Channel 2: appearanceChanged event — live BG update.
            val payload = JavaOnlyMap().apply { putString("colorScheme", scheme) }
            val params = JavaOnlyArray().apply { pushMap(payload) }
            lynxView.sendGlobalEvent(EVENT_NAME, params)
        } catch (e: Throwable) {
            // Defensive — bridge calls during teardown can throw. The next
            // configuration change will republish, so a dropped publish here
            // is non-fatal.
            Log.w(TAG, "publish failed: ${e.message}")
        }
    }
}
