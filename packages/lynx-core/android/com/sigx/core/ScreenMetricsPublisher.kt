package com.sigx.core

import android.content.ComponentCallbacks
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import android.util.Log
import android.view.Surface
import android.view.View
import android.view.WindowManager
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.tasm.LynxView
import com.lynx.tasm.TemplateData
import kotlin.math.roundToInt

/**
 * Publishes the live viewport size + interface orientation to JS (#856) via
 * the two standard publisher channels:
 *
 * 1. **`lynx.__globalProps.screen`** — `{ width, height, scale, orientation }`
 *    (lengths in dp) written with [LynxView.updateGlobalProps] before MT first
 *    paint, so the first render already knows whether it's laying out in
 *    landscape. `__globalProps` is mirrored onto both threads, which makes
 *    this the BG-safe screen-size accessor `lynx.SystemInfo` can't be (#333).
 *
 * 2. **`screenChanged` global event** — fired after each republish; the JS
 *    `useScreen()` signal listens through `GlobalEventEmitter`.
 *
 * It also pushes the new size into the engine with
 * [LynxView.updateScreenMetrics] so `rpx` lengths resolve against the current
 * screen rather than the one the view was built with.
 *
 * **The size signal is the LynxView's own layout**, not the display: an
 * `addOnLayoutChangeListener` fires for every real viewport change — rotation,
 * multi-window resize, foldable unfold — and, unlike a Configuration callback,
 * it reports the size the app actually got. A [ComponentCallbacks2] hook is
 * registered alongside it purely to catch orientation changes that don't
 * resize the view (a square-ish multi-window pane).
 *
 * Runtime rotation requires the hosting Activity to declare
 * `android:configChanges="…|orientation|screenSize|…"` (the managed template
 * does) — without it the Activity is recreated and the bundle reloads, losing
 * app state.
 *
 * Lifecycle: one publisher per LynxView, attached by the generated
 * `GeneratedLifecyclePublishers.attachAll(lynxView)`; mirrors the
 * SafeAreaPublisher / FontScalePublisher shape.
 */
class ScreenMetricsPublisher(private val lynxView: LynxView) {

    private companion object {
        const val TAG = "ScreenMetricsPublisher"
        const val EVENT_NAME = "screenChanged"
    }

    private var lastWidth = 0
    private var lastHeight = 0
    private var lastOrientation = ""
    private var callbacks: ComponentCallbacks? = null

    fun attach() {
        // Seed synchronously from the display so __globalProps is populated
        // before MT first paint — at this point the LynxView has no layout yet.
        publish(displaySizeDp(), orientationName())

        lynxView.addOnLayoutChangeListener { _, left, top, right, bottom, _, _, _, _ ->
            val d = density()
            val w = ((right - left) / d).roundToInt()
            val h = ((bottom - top) / d).roundToInt()
            if (w > 0 && h > 0) publish(w to h, orientationName())
        }

        val appCtx = lynxView.context.applicationContext
        val cb = object : ComponentCallbacks2 {
            override fun onConfigurationChanged(newConfig: Configuration) {
                // The view's layout listener carries the authoritative size;
                // republish here so an orientation flip that leaves the view
                // the same size still updates `orientation`.
                val size = if (lastWidth > 0 && lastHeight > 0) {
                    lastWidth to lastHeight
                } else {
                    displaySizeDp()
                }
                publish(size, orientationName())
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
                // nothing the host can do about it.
            }
            callbacks = null
        }
    }

    private fun density(): Float =
        lynxView.resources.displayMetrics.density.takeIf { it > 0f } ?: 1f

    /** Whole-display size in dp — the pre-layout seed. */
    private fun displaySizeDp(): Pair<Int, Int> {
        val metrics = lynxView.resources.displayMetrics
        val d = metrics.density.takeIf { it > 0f } ?: 1f
        return (metrics.widthPixels / d).roundToInt() to (metrics.heightPixels / d).roundToInt()
    }

    /**
     * Interface orientation as the JS `ScreenOrientation` union.
     *
     * `Configuration.orientation` gives the axis; the display rotation
     * disambiguates which way round. Rotation is relative to the device's
     * NATURAL orientation, so a natural-landscape device (many tablets) maps
     * the same rotation to the opposite name — hence the axis, not the
     * rotation, decides portrait vs landscape.
     */
    private fun orientationName(): String {
        val landscape =
            lynxView.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
        val rotation = try {
            @Suppress("DEPRECATION")
            (lynxView.context.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
                .defaultDisplay.rotation
        } catch (_: Throwable) {
            Surface.ROTATION_0
        }
        return if (landscape) {
            // ROTATION_90 = device turned counter-clockwise = the home button
            // ends up on the left, which is iOS's `landscapeLeft`.
            if (rotation == Surface.ROTATION_270) "landscape-right" else "landscape-left"
        } else {
            if (rotation == Surface.ROTATION_180) "portrait-upside-down" else "portrait"
        }
    }

    private fun publish(size: Pair<Int, Int>, orientation: String) {
        val (width, height) = size
        if (width <= 0 || height <= 0) return
        if (width == lastWidth && height == lastHeight && orientation == lastOrientation) return
        lastWidth = width
        lastHeight = height
        lastOrientation = orientation

        val density = density()
        val map: Map<String, Any> = mapOf(
            "width" to width,
            "height" to height,
            "scale" to density.toDouble(),
            "orientation" to orientation,
        )

        try {
            // Keep `rpx` resolving against the current screen. This does NOT
            // relayout by itself — the LynxView is MATCH_PARENT, so Android's
            // own layout pass has already remeasured it by the time we get here.
            // Physical px: Android's LynxView takes screen metrics in pixels
            // (its iOS counterpart documents dp), matching how the engine seeds
            // them from DisplayMetrics at construction.
            lynxView.updateScreenMetrics(
                (width * density).roundToInt(),
                (height * density).roundToInt(),
            )

            // Channel 1: __globalProps — sync MT/BG read.
            lynxView.updateGlobalProps(TemplateData.fromMap(mapOf("screen" to map)))

            // Channel 2: screenChanged event — live update for `useScreen()`.
            // sendGlobalEvent expects a JavaOnlyArray (Lynx bridge type); the
            // first element is the listener's first argument.
            val payload = JavaOnlyMap().apply {
                putInt("width", width)
                putInt("height", height)
                putDouble("scale", density.toDouble())
                putString("orientation", orientation)
            }
            lynxView.sendGlobalEvent(EVENT_NAME, JavaOnlyArray().apply { pushMap(payload) })
        } catch (e: Throwable) {
            // Defensive — bridge calls during teardown can throw. The next
            // layout/configuration change republishes, so a dropped publish
            // here is non-fatal.
            Log.w(TAG, "publish failed: ${e.message}")
        }
    }
}
