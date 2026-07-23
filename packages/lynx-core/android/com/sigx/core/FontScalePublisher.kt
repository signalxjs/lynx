package com.sigx.core

import android.content.ComponentCallbacks
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import android.util.Log
import android.view.View
import com.lynx.tasm.LynxView
import com.lynx.tasm.TemplateData

/**
 * Publishes the OS font-size setting to the LynxView and JS:
 *
 * 1. **`lynx.__globalProps.fontScale`** — `{ scale, os }` populated
 *    synchronously via [LynxView.updateGlobalProps] before MT first paint
 *    (`scale` = policy-clamped effective value the engine applies, `os` = raw
 *    unclamped [Configuration.fontScale]).
 *
 * 2. **[LynxView.updateFontScale]** — pushes the effective scale into the
 *    engine on every configuration change; the engine relayouts and emits the
 *    `onFontScaleChanged` global event to JS itself, so no custom change
 *    event is needed here.
 *
 * Runtime changes require the hosting Activity to declare
 * `android:configChanges="fontScale"` (the managed template does) — without
 * it the Activity is recreated instead and the rebuilt view re-seeds from the
 * builder, which is equivalent minus the in-place relayout.
 *
 * The builder-time `setFontScale` seed (managed MainActivity template) covers
 * first layout; the `updateFontScale` call in [attach] is a no-op then, but
 * makes the publisher self-sufficient for custom hosts that omit the seed.
 *
 * Lifecycle: one publisher per LynxView, attached by the generated
 * `GeneratedLifecyclePublishers.attachAll(lynxView)`; mirrors
 * AppearancePublisher's ComponentCallbacks2 registration/detach shape.
 */
class FontScalePublisher(private val lynxView: LynxView) {

    private companion object {
        const val TAG = "FontScalePublisher"
    }

    private var lastEffective: Float = 0f
    private var callbacks: ComponentCallbacks? = null

    fun attach() {
        // Seed synchronously so __globalProps is populated before MT first
        // paint reads it.
        publish(lynxView.resources.configuration)

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
        val effective = SigxFontScale.effective(config)
        if (effective == lastEffective) return
        lastEffective = effective

        try {
            // `os` is only re-read alongside an effective change; JS-side live
            // updates ride the engine's own onFontScaleChanged event.
            lynxView.updateGlobalProps(
                TemplateData.fromMap(
                    mapOf(
                        "fontScale" to mapOf(
                            "scale" to effective.toDouble(),
                            "os" to config.fontScale.toDouble(),
                        ),
                    ),
                ),
            )
            lynxView.updateFontScale(effective)
        } catch (e: Throwable) {
            // Defensive — bridge calls during teardown can throw. The next
            // configuration change will republish, so a dropped publish here
            // is non-fatal.
            Log.w(TAG, "publish failed: ${e.message}")
        }
    }
}
