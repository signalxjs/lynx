package com.sigx.audio

import com.lynx.react.bridge.JavaOnlyMap
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Process-wide pub/sub for audio events. Players + recorders publish here;
 * per-LynxView [AudioPublisher] instances read and forward via
 * `LynxView.sendGlobalEvent(channel, [...])`.
 *
 * Each emission carries both a channel name (e.g. `__sigxAudioEnd:42`) and
 * a JSON-encodable payload. The JS side subscribes on per-id channels so
 * the JS shim can demux without parsing the payload first.
 */
internal object AudioEventBus {

    private val listeners = CopyOnWriteArrayList<Pair<UUID, (String, JavaOnlyMap) -> Unit>>()

    fun addListener(fn: (String, JavaOnlyMap) -> Unit): UUID {
        val token = UUID.randomUUID()
        listeners.add(token to fn)
        return token
    }

    fun removeListener(token: UUID) {
        listeners.removeAll { it.first == token }
    }

    fun publishPlayerEnd(id: Long) {
        val payload = JavaOnlyMap()
        payload.putDouble("id", id.toDouble())
        emit("__sigxAudioEnd:$id", payload)
    }

    fun publishMeter(id: Long, peak: Double, avg: Double) {
        val payload = JavaOnlyMap()
        payload.putDouble("id", id.toDouble())
        payload.putDouble("peak", peak)
        payload.putDouble("avg", avg)
        emit("__sigxAudioMeter:$id", payload)
    }

    private fun emit(channel: String, payload: JavaOnlyMap) {
        for ((_, fn) in listeners) fn(channel, payload)
    }
}
