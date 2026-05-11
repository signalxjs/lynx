package com.sigx.linking

import android.content.Intent
import android.util.Log

/**
 * Static façade between the host MainActivity and the per-LynxView
 * [LinkingPublisher] instances. The host calls [handleNewIntent] from its
 * `onCreate` (initial intent) and `onNewIntent` (warm-start) overrides;
 * publishers attached *before* the URL arrived receive it via the registered
 * listener, while publishers attached *after* read [latestURL] during their
 * init so cold-start links still seed `__globalProps.initialURL`.
 *
 * Reflectively callable by the MainActivity template — apps that don't pull
 * in `@sigx/lynx-linking` keep compiling because the template uses
 * `Class.forName("com.sigx.linking.LinkingState")` rather than a direct
 * import.
 */
object LinkingState {
    private const val TAG = "LinkingState"

    @Volatile
    var latestURL: String? = null
        private set

    private val listeners = mutableListOf<(String) -> Unit>()
    private val lock = Any()

    /**
     * Forward an incoming deep-link intent from the host MainActivity. Safe
     * to call from any thread; listeners are invoked synchronously on the
     * caller's thread (publishers hop to the LynxView's thread internally
     * via the Lynx bridge).
     */
    @JvmStatic
    fun handleNewIntent(intent: Intent?) {
        val url = intent?.data?.toString() ?: return
        val snapshot: List<(String) -> Unit>
        synchronized(lock) {
            latestURL = url
            snapshot = listeners.toList()
        }
        for (listener in snapshot) {
            try {
                listener(url)
            } catch (e: Throwable) {
                Log.w(TAG, "Listener threw: ${e.message}")
            }
        }
    }

    /** Register a listener; returns an unsubscribe function. */
    fun addListener(listener: (String) -> Unit): () -> Unit {
        synchronized(lock) { listeners.add(listener) }
        return {
            synchronized(lock) { listeners.remove(listener) }
        }
    }
}
