package com.sigx.linking

import android.util.Log
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.tasm.LynxView
import com.lynx.tasm.TemplateData

/**
 * Per-LynxView publisher that bridges incoming deep links from
 * [LinkingState] into the LynxView's two native→JS channels:
 *
 * 1. **`lynx.__globalProps.initialURL`** — set via
 *    [LynxView.updateGlobalProps] so the JS bundle can read the launch URL
 *    synchronously on first paint.
 * 2. **`urlReceived` global event** — fired via [LynxView.sendGlobalEvent]
 *    so JS subscribers (`lynx.getJSModule("GlobalEventEmitter").addListener`)
 *    receive warm-start deep links.
 *
 * Mirrors the dual-channel pattern from `@sigx/lynx-safe-area`'s
 * `SafeAreaPublisher`. One instance per LynxView; retained by the host via
 * the generated `GeneratedLifecyclePublishers.attachAll`.
 */
class LinkingPublisher(private val lynxView: LynxView) {

    private var unsubscribeUrl: (() -> Unit)? = null
    private var unsubscribeBack: (() -> Unit)? = null

    fun attach() {
        // Cold-start case: the host MainActivity has already forwarded the
        // launch URL into LinkingState before this LynxView was constructed.
        // Seed globalProps synchronously so the bundle's first sync read of
        // `lynx.__globalProps.initialURL` returns the URL.
        LinkingState.latestURL?.let { url ->
            try {
                lynxView.updateGlobalProps(TemplateData.fromMap(mapOf("initialURL" to url)))
            } catch (e: Throwable) {
                Log.w(TAG, "seed updateGlobalProps failed: ${e.message}")
            }
        }

        // Warm-start URL case: forward each incoming URL on both channels.
        unsubscribeUrl = LinkingState.addListener { url ->
            try {
                lynxView.updateGlobalProps(TemplateData.fromMap(mapOf("initialURL" to url)))
                val params = JavaOnlyArray().apply { pushString(url) }
                lynxView.sendGlobalEvent(URL_EVENT, params)
            } catch (e: Throwable) {
                // LynxView may be mid-teardown; don't crash the host app.
                Log.w(TAG, "publish failed: ${e.message}")
            }
        }

        // Hardware-back: forward each press to JS via the same global-event
        // channel. JS decides whether to pop a navigator or call back into
        // `LinkingModule.exitApp()` to leave the app.
        unsubscribeBack = BackHandlerState.addListener {
            try {
                lynxView.sendGlobalEvent(BACK_EVENT, JavaOnlyArray())
            } catch (e: Throwable) {
                Log.w(TAG, "back-press publish failed: ${e.message}")
            }
        }
    }

    private companion object {
        const val TAG = "LinkingPublisher"
        const val URL_EVENT = "urlReceived"
        const val BACK_EVENT = "hardwareBackPress"
    }
}
