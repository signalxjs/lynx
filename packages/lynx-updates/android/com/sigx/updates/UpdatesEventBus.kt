package com.sigx.updates

import com.lynx.react.bridge.JavaOnlyMap
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Module → publisher event bus (the `BackgroundEventBus` pattern). The
 * module emits download progress / foreground events here; the per-LynxView
 * [UpdatesLifecyclePublisher] pumps them into JS via `sendGlobalEvent` on
 * the `__sigxUpdatesEvent` channel.
 */
object UpdatesEventBus {

    const val CHANNEL = "__sigxUpdatesEvent"

    private val listeners = ConcurrentHashMap<UUID, (JavaOnlyMap) -> Unit>()

    fun addListener(listener: (JavaOnlyMap) -> Unit): UUID {
        val token = UUID.randomUUID()
        listeners[token] = listener
        return token
    }

    fun removeListener(token: UUID) {
        listeners.remove(token)
    }

    fun emit(payload: JavaOnlyMap) {
        for (listener in listeners.values) {
            try {
                listener(payload)
            } catch (_: Throwable) {
                // A broken publisher must not break the others.
            }
        }
    }

    fun emitProgress(receivedBytes: Long, totalBytes: Long?) {
        val map = JavaOnlyMap()
        map.putString("kind", "progress")
        map.putDouble("receivedBytes", receivedBytes.toDouble())
        if (totalBytes != null && totalBytes >= 0) {
            map.putDouble("totalBytes", totalBytes.toDouble())
        }
        emit(map)
    }

    fun emitForeground() {
        val map = JavaOnlyMap()
        map.putString("kind", "foreground")
        emit(map)
    }
}
