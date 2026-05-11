package com.sigx.linking

import android.util.Log

/**
 * Static façade between the host MainActivity and the per-LynxView
 * [LinkingPublisher] instances for hardware-back-button delivery. Mirrors the
 * shape of [LinkingState] (URL delivery), reusing the same reflective hook
 * pattern from MainActivity so apps that don't pull in `@sigx/lynx-linking`
 * still compile.
 *
 * Flow:
 *   1. MainActivity overrides `onBackPressed` and reflectively calls
 *      [dispatch].
 *   2. If any subscribers are registered (i.e. a LynxView is attached and its
 *      bundle has loaded), [dispatch] returns `true` — MainActivity treats the
 *      press as consumed and skips `super.onBackPressed()`. The subscribers
 *      forward the event to JS via `lynx.sendGlobalEvent("hardwareBackPress")`.
 *   3. JS decides what to do: pop the navigator if there's history, otherwise
 *      call back into native via `LinkingModule.exitApp()` to leave the app.
 *   4. If no subscribers (cold launch, before the bundle is loaded),
 *      [dispatch] returns `false` and MainActivity falls through to the OS
 *      default (Activity finishes / system back).
 *
 * Reflectively callable by the MainActivity template — apps without
 * `@sigx/lynx-linking` keep compiling because the template uses
 * `Class.forName("com.sigx.linking.BackHandlerState")`.
 */
object BackHandlerState {
    private const val TAG = "BackHandlerState"

    private val listeners = mutableListOf<() -> Unit>()
    private val lock = Any()

    /**
     * Dispatch a hardware-back press. Returns `true` if any listener is
     * registered (the press is considered consumed and JS will handle it),
     * `false` if there are no listeners (host should fall through to default
     * back behavior).
     */
    @JvmStatic
    fun dispatch(): Boolean {
        val snapshot: List<() -> Unit>
        synchronized(lock) {
            if (listeners.isEmpty()) return false
            snapshot = listeners.toList()
        }
        for (listener in snapshot) {
            try {
                listener()
            } catch (e: Throwable) {
                Log.w(TAG, "Listener threw: ${e.message}")
            }
        }
        return true
    }

    /** Register a listener; returns an unsubscribe function. */
    fun addListener(listener: () -> Unit): () -> Unit {
        synchronized(lock) { listeners.add(listener) }
        return {
            synchronized(lock) { listeners.remove(listener) }
        }
    }
}
