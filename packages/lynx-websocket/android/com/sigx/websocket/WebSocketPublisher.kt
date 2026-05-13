package com.sigx.websocket

import android.util.Log
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.tasm.LynxView
import java.util.UUID

/**
 * Per-[LynxView] publisher that pumps [WebSocketEventBus] payloads into JS
 * via `LynxView.sendGlobalEvent("__sigxWebSocketEvent", [...])`.
 *
 * One instance per LynxView; instantiated by the generated
 * `GeneratedLifecyclePublishers.attachAll(lynxView)` and retained for the
 * LynxView's lifetime. The bus is global so opening a socket from one
 * LynxView and reading it from another (via the JS shim) works, but in
 * practice each LynxView holds its own JS heap so events are delivered to
 * the matching view only.
 */
class WebSocketPublisher(private val lynxView: LynxView) {

    private var token: UUID? = null

    fun attach() {
        token = WebSocketEventBus.addListener { payload ->
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
        token?.let { WebSocketEventBus.removeListener(it) }
        token = null
    }

    private companion object {
        const val TAG = "SigxWebSocketPublisher"
        const val EVENT_NAME = "__sigxWebSocketEvent"
    }
}
