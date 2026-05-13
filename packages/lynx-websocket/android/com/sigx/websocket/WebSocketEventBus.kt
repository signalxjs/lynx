package com.sigx.websocket

import com.lynx.react.bridge.JavaOnlyMap
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Process-wide pub/sub bus that owns the conversion of native WebSocket
 * callbacks into JS-side event payloads. OkHttp listeners write here;
 * per-LynxView [WebSocketPublisher] instances read.
 *
 * Mirrors the publisher pattern used elsewhere in the repo
 * (`LinkingState`, `SafeAreaPublisher`, …): native lifecycle is decoupled
 * from any specific LynxView so events survive view recreation and
 * per-view subscribers can fan out without holding onto the WS task.
 *
 * Payload keys match the `NativeEvent` interface in `src/websocket.ts`.
 */
internal object WebSocketEventBus {

    private val listeners = CopyOnWriteArrayList<Pair<UUID, (JavaOnlyMap) -> Unit>>()

    fun addListener(fn: (JavaOnlyMap) -> Unit): UUID {
        val token = UUID.randomUUID()
        listeners.add(token to fn)
        return token
    }

    fun removeListener(token: UUID) {
        listeners.removeAll { it.first == token }
    }

    fun publishOpen(id: Int, protocol: String, extensions: String) {
        emit(
            mapOf(
                "id" to id,
                "type" to "open",
                "protocol" to protocol,
                "extensions" to extensions,
            )
        )
    }

    fun publishMessageText(id: Int, text: String) {
        emit(
            mapOf(
                "id" to id,
                "type" to "message",
                "data" to text,
                "isBinary" to false,
            )
        )
    }

    fun publishMessageBinary(id: Int, base64: String) {
        emit(
            mapOf(
                "id" to id,
                "type" to "message",
                "binary" to base64,
                "isBinary" to true,
            )
        )
    }

    fun publishError(id: Int, message: String) {
        emit(
            mapOf(
                "id" to id,
                "type" to "error",
                "data" to message,
            )
        )
    }

    fun publishClose(id: Int, code: Int, reason: String, wasClean: Boolean) {
        emit(
            mapOf(
                "id" to id,
                "type" to "close",
                "code" to code,
                "reason" to reason,
                "wasClean" to wasClean,
            )
        )
    }

    private fun emit(payload: Map<String, Any>) {
        // JavaOnlyMap doesn't ship a `from(Map)` overload that handles
        // mixed value types on every host, so build it explicitly to keep
        // the bridge happy.
        val map = JavaOnlyMap()
        for ((k, v) in payload) {
            when (v) {
                is String -> map.putString(k, v)
                is Int -> map.putInt(k, v)
                is Double -> map.putDouble(k, v)
                is Boolean -> map.putBoolean(k, v)
                else -> map.putString(k, v.toString())
            }
        }
        for ((_, fn) in listeners) fn(map)
    }
}
