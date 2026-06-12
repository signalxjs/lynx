package com.sigx.webrtc

import android.util.Log
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.tasm.LynxView
import java.util.UUID

/**
 * Per-[LynxView] publisher that pumps [WebRTCEventBus] payloads into JS
 * via `LynxView.sendGlobalEvent("__sigxWebRTCEvent", [...])`.
 *
 * One instance per LynxView; instantiated by the generated
 * `GeneratedLifecyclePublishers.attachAll(lynxView)` and retained for the
 * LynxView's lifetime.
 */
class WebRTCPublisher(private val lynxView: LynxView) {

    private var token: UUID? = null

    fun attach() {
        token = WebRTCEventBus.addListener { payload ->
            try {
                val params = JavaOnlyArray()
                params.pushMap(payload)
                lynxView.sendGlobalEvent(EVENT_NAME, params)
            } catch (e: Throwable) {
                Log.w(TAG, "publish failed: ${e.message}")
            }
        }
    }

    fun detach() {
        token?.let { WebRTCEventBus.removeListener(it) }
        token = null
    }

    private companion object {
        const val TAG = "SigxWebRTCPublisher"
        const val EVENT_NAME = "__sigxWebRTCEvent"
    }
}
