package com.sigx.appstate

import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Process-wide app-state holder + listener registry. Fed by
 * [AppStateActivityHook] (onResume/onPause), drained by per-LynxView
 * [AppStatePublisher]s that forward transitions to JS, and read synchronously
 * by [AppStateModule.getAppState].
 *
 * Two-state model: `"active"` | `"background"`. Consecutive duplicates are
 * dropped here so publishers never spam JS (e.g. the first onResume of a
 * launch, when the state is already the `"active"` default).
 */
object AppStateBus {

    const val STATE_ACTIVE = "active"
    const val STATE_BACKGROUND = "background"

    @Volatile
    var current: String = STATE_ACTIVE
        private set

    private val listeners = ConcurrentHashMap<UUID, (String) -> Unit>()

    fun emit(state: String) {
        if (state == current) return
        current = state
        for (listener in listeners.values) listener(state)
    }

    fun addListener(listener: (String) -> Unit): UUID {
        val token = UUID.randomUUID()
        listeners[token] = listener
        return token
    }

    fun removeListener(token: UUID) {
        listeners.remove(token)
    }
}
