package com.sigx.http

import org.json.JSONObject
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
 * Payloads are emitted as a **JSON string** whose parsed shape matches the
 * `NativeHttpEvent` interface in `src/types.ts`. A string (rather than a
 * structured `JavaOnlyMap`) survives Lynx 0.5.0's bridge marshalling intact
 * — a map carrying a nested map (the `response` event's `headers`) drops its
 * sibling scalar fields crossing the bridge, so `Response.status` arrived
 * undefined and `res.ok` was false for every request (#342). The JS shim
 * already parses string-form events.
 *
 * Event order per request id: response (once) → progress* → chunk* →
 * done | error.
 */
internal object HttpEventBus {

    private val listeners = CopyOnWriteArrayList<Pair<UUID, (String) -> Unit>>()

    fun addListener(fn: (String) -> Unit): UUID {
        val token = UUID.randomUUID()
        listeners.add(token to fn)
        return token
    }

    fun removeListener(token: UUID) {
        listeners.removeAll { it.first == token }
    }

    fun publishResponse(id: Int, status: Int, statusText: String, headers: Map<String, String>) {
        val obj = JSONObject()
        obj.put("id", id)
        obj.put("type", "response")
        obj.put("status", status)
        obj.put("statusText", statusText)
        val headerObj = JSONObject()
        for ((k, v) in headers) headerObj.put(k, v)
        obj.put("headers", headerObj)
        emit(obj)
    }

    fun publishChunk(id: Int, base64: String) {
        val obj = JSONObject()
        obj.put("id", id)
        obj.put("type", "chunk")
        obj.put("data", base64)
        emit(obj)
    }

    fun publishProgress(id: Int, loaded: Long, total: Long) {
        val obj = JSONObject()
        obj.put("id", id)
        obj.put("type", "progress")
        obj.put("loaded", loaded)
        obj.put("total", total)
        emit(obj)
    }

    fun publishDone(id: Int) {
        val obj = JSONObject()
        obj.put("id", id)
        obj.put("type", "done")
        emit(obj)
    }

    fun publishError(id: Int, message: String) {
        val obj = JSONObject()
        obj.put("id", id)
        obj.put("type", "error")
        obj.put("message", message)
        emit(obj)
    }

    private fun emit(payload: JSONObject) {
        val json = payload.toString()
        for ((_, fn) in listeners) fn(json)
    }
}
