package com.sigx.http

import android.util.Log
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.tasm.LynxView
import java.util.UUID

/**
 * Per-[LynxView] publisher that pumps [HttpEventBus] payloads into JS via
 * `LynxView.sendGlobalEvent("__sigxHttpEvent", [...])`.
 *
 * One instance per LynxView; instantiated by the generated
 * `GeneratedLifecyclePublishers.attachAll(lynxView)` and retained for the
 * LynxView's lifetime — same wiring as `WebSocketPublisher`.
 */
class HttpPublisher(private val lynxView: LynxView) {

    private var token: UUID? = null

    fun attach() {
        token = HttpEventBus.addListener { json ->
            try {
                // Pass a single JSON string as the only param — the JS shim
                // parses the first arg as `NativeHttpEvent`. A string survives
                // Lynx 0.5.0's bridge marshalling intact where a structured
                // map carrying a nested `headers` map does not (#342).
                val params = JavaOnlyArray()
                params.pushString(json)
                lynxView.sendGlobalEvent(EVENT_NAME, params)
            } catch (e: Throwable) {
                Log.w(TAG, "publish failed: ${e.message}")
            }
        }
    }

    fun detach() {
        token?.let { HttpEventBus.removeListener(it) }
        token = null
    }

    private companion object {
        const val TAG = "SigxHttpPublisher"
        const val EVENT_NAME = "__sigxHttpEvent"
    }
}
