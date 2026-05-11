package com.sigx.safearea

import android.util.Log
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.tasm.LynxView
import com.lynx.tasm.TemplateData

/**
 * Publishes the device safe-area insets (status bar, navigation bar, gesture
 * inset, IME / soft keyboard) to JS via two channels:
 *
 * 1. **`lynx.__globalProps.safeArea`** — populated synchronously via
 *    [LynxView.updateGlobalProps]. The MT bundle reads `__globalProps`
 *    synchronously before its first render, giving inset-aware first paint
 *    with no flash of unsafe content.
 *
 * 2. **`safeAreaChanged` global event** — fired via [LynxView.sendGlobalEvent]
 *    after each republish. The JS `<SafeAreaProvider>` subscribes via
 *    `lynx.getJSModule("GlobalEventEmitter").addListener` and updates its
 *    reactive signal. Drives live updates on rotation, multi-window
 *    split-screen, foldable hinge state, IME show/hide.
 *
 * Lifecycle: instantiate one publisher per [LynxView]; call [attach] *before*
 * `renderTemplateUrl` so the initial inset map is in `__globalProps` before
 * MT first paint. The publisher hooks `OnApplyWindowInsetsListener` on the
 * LynxView itself, which delivers updates as soon as the view is laid out
 * and on every subsequent insets change.
 *
 * Fills the gap from upstream Lynx: as of LynxJS 3.6 the C++ renderer
 * doesn't populate `env(safe-area-inset-*)` on Android (open PR #5296).
 * Going through `__globalProps` works on every supported Android version.
 */
class SafeAreaPublisher(private val lynxView: LynxView) {

    private companion object {
        const val TAG = "SafeAreaPublisher"
        const val EVENT_NAME = "safeAreaChanged"
    }

    private var lastInsets: WindowInsetsCompat? = null
    private var lastKeyboard: Float = 0f

    fun attach() {
        // Set the listener BEFORE the LynxView is added to a window so we
        // catch the initial WindowInsets dispatch. The listener returns the
        // insets unchanged so other consumers in the view tree still see them.
        ViewCompat.setOnApplyWindowInsetsListener(lynxView) { _, insets ->
            lastInsets = insets
            publish(insets)
            insets
        }

        // Force a publish in case insets were already delivered before the
        // listener attached (happens when LynxView is reattached during HMR
        // / activity recreation). ViewCompat.getRootWindowInsets is
        // null-safe and returns whatever the platform last computed.
        ViewCompat.getRootWindowInsets(lynxView)?.let { publish(it) }
    }

    private fun publish(insets: WindowInsetsCompat) {
        val density = lynxView.resources.displayMetrics.density.takeIf { it > 0 } ?: 1f

        // Lynx layout works in density-independent pixels; WindowInsets
        // delivers physical pixels. Divide by density once at the boundary
        // so the JS side gets dp values that map 1:1 to its other layout
        // numbers (preferredLayoutWidth, etc.).
        val sys = insets.getInsets(WindowInsetsCompat.Type.systemBars())
        val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
        val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
        val gestures = insets.getInsets(WindowInsetsCompat.Type.systemGestures())

        // Top: max of system-bar (status bar) and display cutout (notch).
        // The two can disagree on devices where the notch extends slightly
        // into the status-bar area; taking the max gives a conservative
        // safe area that always clears both.
        val top = maxOf(sys.top, cutout.top) / density
        val right = maxOf(sys.right, cutout.right) / density
        val bottom = maxOf(sys.bottom, cutout.bottom, gestures.bottom) / density
        val left = maxOf(sys.left, cutout.left) / density
        val keyboard = ime.bottom / density
        lastKeyboard = keyboard

        val map: Map<String, Any> = mapOf(
            "top" to top.toDouble(),
            "right" to right.toDouble(),
            "bottom" to bottom.toDouble(),
            "left" to left.toDouble(),
            "keyboard" to keyboard.toDouble(),
            "statusBar" to (sys.top / density).toDouble(),
            "navigationBar" to (sys.bottom / density).toDouble(),
        )

        try {
            // Channel 1: __globalProps — sync MT read at first paint.
            lynxView.updateGlobalProps(TemplateData.fromMap(mapOf("safeArea" to map)))

            // Channel 2: safeAreaChanged event — live update for the BG-side
            // <SafeAreaProvider> listener. sendGlobalEvent expects a
            // JavaOnlyArray (Lynx bridge type), not a Kotlin List. The
            // first array element is what GlobalEventEmitter.addListener
            // delivers as the listener's first argument.
            val payload = JavaOnlyMap().apply {
                for ((k, v) in map) {
                    when (v) {
                        is Double -> putDouble(k, v)
                        is Int -> putInt(k, v)
                        is Boolean -> putBoolean(k, v)
                        is String -> putString(k, v)
                        else -> putString(k, v.toString())
                    }
                }
            }
            val params = JavaOnlyArray().apply { pushMap(payload) }
            lynxView.sendGlobalEvent(EVENT_NAME, params)
        } catch (e: Throwable) {
            // Defensive: if the LynxView is mid-teardown the bridge call
            // can throw. Don't crash the host app over a missed inset
            // notification — the next layout pass will re-publish.
            Log.w(TAG, "publish failed: ${e.message}")
        }
    }
}
