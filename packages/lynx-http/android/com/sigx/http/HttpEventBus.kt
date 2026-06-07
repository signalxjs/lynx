package com.sigx.http

import com.lynx.react.bridge.JavaOnlyMap
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Process-wide pub/sub bus that owns the conversion of OkHttp callbacks
 * into JS-side event payloads. OkHttp callbacks write here; per-LynxView
 * [HttpPublisher] instances read.
 *
 * Mirrors `WebSocketEventBus` — native lifecycle is decoupled from any
 * specific LynxView so in-flight requests survive view recreation.
 *
 * Payload keys match the `NativeHttpEvent` interface in `src/types.ts`.
 * Event order per request id: response (once) → progress* → chunk* →
 * done | error.
 */
internal object HttpEventBus {

    private val listeners = CopyOnWriteArrayList<Pair<UUID, (JavaOnlyMap) -> Unit>>()

    fun addListener(fn: (JavaOnlyMap) -> Unit): UUID {
        val token = UUID.randomUUID()
        listeners.add(token to fn)
        return token
    }

    fun removeListener(token: UUID) {
        listeners.removeAll { it.first == token }
    }

    fun publishResponse(id: Int, status: Int, statusText: String, headers: Map<String, String>) {
        val map = JavaOnlyMap()
        map.putInt("id", id)
        map.putString("type", "response")
        map.putInt("status", status)
        map.putString("statusText", statusText)
        val headerMap = JavaOnlyMap()
        for ((k, v) in headers) headerMap.putString(k, v)
        map.putMap("headers", headerMap)
        emit(map)
    }

    fun publishChunk(id: Int, base64: String) {
        val map = JavaOnlyMap()
        map.putInt("id", id)
        map.putString("type", "chunk")
        map.putString("data", base64)
        emit(map)
    }

    fun publishProgress(id: Int, loaded: Long, total: Long) {
        val map = JavaOnlyMap()
        map.putInt("id", id)
        map.putString("type", "progress")
        map.putDouble("loaded", loaded.toDouble())
        map.putDouble("total", total.toDouble())
        emit(map)
    }

    fun publishDone(id: Int) {
        val map = JavaOnlyMap()
        map.putInt("id", id)
        map.putString("type", "done")
        emit(map)
    }

    fun publishError(id: Int, message: String) {
        val map = JavaOnlyMap()
        map.putInt("id", id)
        map.putString("type", "error")
        map.putString("message", message)
        emit(map)
    }

    private fun emit(payload: JavaOnlyMap) {
        for ((_, fn) in listeners) fn(payload)
    }
}
