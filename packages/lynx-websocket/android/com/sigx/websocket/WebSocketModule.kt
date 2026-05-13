package com.sigx.websocket

import android.content.Context
import android.util.Log
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableArray

/**
 * Native WebSocket bridge — JS-callable side.
 *
 * JS usage (via the `@sigx/lynx-websocket` shim, not directly):
 *
 *   NativeModules.WebSocket.create(id, url, protocols, cb)
 *   NativeModules.WebSocket.send(id, payload, isBinary, cb)
 *   NativeModules.WebSocket.close(id, code, reason, cb)
 *
 * Async lifecycle events (`open`, `message`, `error`, `close`) are pushed
 * back via [WebSocketEventBus], which a per-LynxView [WebSocketPublisher]
 * forwards to JS through `LynxView.sendGlobalEvent("__sigxWebSocketEvent",
 * [...])`.
 *
 * Implemented with OkHttp's WebSocket. Each socket is stored in
 * [WebSocketTaskStore] keyed by the JS-supplied numeric id; the same id is
 * echoed back in every event so the JS shim can demultiplex.
 */
class WebSocketModule(context: Context) : LynxModule(context) {

    @LynxMethod
    fun create(id: Int, url: String?, protocols: ReadableArray?, callback: Callback?) {
        if (url.isNullOrEmpty()) {
            WebSocketEventBus.publishError(id, "Invalid URL")
            WebSocketEventBus.publishClose(id, 1006, "Invalid URL", wasClean = false)
            callback?.invoke(JavaOnlyMap.from(emptyMap<String, Any>()))
            return
        }

        val protoList = mutableListOf<String>()
        if (protocols != null) {
            for (i in 0 until protocols.size()) {
                val v = protocols.getString(i)
                if (!v.isNullOrEmpty()) protoList.add(v)
            }
        }

        try {
            WebSocketTaskStore.create(id, url, protoList)
            callback?.invoke(JavaOnlyMap.from(emptyMap<String, Any>()))
        } catch (e: Exception) {
            Log.e(TAG, "create($id) failed: ${e.message}")
            WebSocketEventBus.publishError(id, e.message ?: "create failed")
            WebSocketEventBus.publishClose(id, 1006, e.message ?: "", wasClean = false)
            callback?.invoke(JavaOnlyMap.from(mapOf("error" to (e.message ?: "create failed"))))
        }
    }

    @LynxMethod
    fun send(id: Int, payload: String?, isBinary: Boolean, callback: Callback?) {
        val ok = WebSocketTaskStore.send(id, payload ?: "", isBinary)
        if (!ok) {
            callback?.invoke(JavaOnlyMap.from(mapOf("error" to "WebSocket $id not found or not open")))
            return
        }
        callback?.invoke(JavaOnlyMap.from(emptyMap<String, Any>()))
    }

    @LynxMethod
    fun close(id: Int, code: Int, reason: String?, callback: Callback?) {
        WebSocketTaskStore.close(id, code, reason ?: "")
        callback?.invoke(JavaOnlyMap.from(emptyMap<String, Any>()))
    }

    private companion object {
        const val TAG = "SigxWebSocketModule"
    }
}
