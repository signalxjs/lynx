package com.sigx.background

import android.util.Log
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.tasm.LynxView
import java.util.UUID

/**
 * Per-[LynxView] publisher that pumps [BackgroundEventBus] payloads into JS
 * via `LynxView.sendGlobalEvent(channel, [payload])`.
 *
 * One instance per LynxView; instantiated by the generated
 * `GeneratedLifecyclePublishers.attachAll(lynxView)` and retained for the
 * LynxView's lifetime.
 */
class BackgroundPublisher(private val lynxView: LynxView) {

    private var token: UUID? = null

    fun attach() {
        token = BackgroundEventBus.addListener { channel, payload ->
            try {
                val params = JavaOnlyArray()
                params.pushMap(payload)
                lynxView.sendGlobalEvent(channel, params)
            } catch (e: Throwable) {
                Log.w(TAG, "publish failed: ${e.message}")
            }
        }
    }

    fun detach() {
        token?.let { BackgroundEventBus.removeListener(it) }
        token = null
    }

    private companion object {
        const val TAG = "SigxBackgroundPublisher"
    }
}
