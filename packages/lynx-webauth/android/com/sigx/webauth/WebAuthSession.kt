package com.sigx.webauth

import android.net.Uri
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.sigx.linking.LinkingState

/**
 * Shared state machine for an in-flight Custom Tabs auth session.
 *
 * Chrome Custom Tabs give us neither a result callback nor a cancel signal, so
 * we reconstruct both from Activity lifecycle + the deep-link pipeline:
 *
 *  - **success** — the provider redirects to `scheme://…`, which Android routes
 *    to `MainActivity` and `@sigx/lynx-linking` forwards into
 *    [LinkingState.handleNewIntent]. We register an interceptor there
 *    ([begin]) that claims the matching redirect, resolving the session and
 *    suppressing the duplicate `Linking` 'url' event.
 *  - **cancel** — the user dismisses the tab without redirecting. Only
 *    `onResume` fires then (no `onNewIntent`), and `onNewIntent` always runs
 *    *before* `onResume` on the success path — so a still-pending, already-
 *    launched session seen in [onHostResume] means the user backed out.
 *
 * Auth is modal, so at most one session is tracked at a time.
 */
object WebAuthSession {

    private val lock = Any()
    private var pending: Pending? = null

    private class Pending(
        val sessionId: String,
        val scheme: String,
        val callback: Callback?,
    ) {
        var finished = false
        var launched = false
        var unsubscribe: (() -> Unit)? = null
    }

    /**
     * Register a pending session and the [LinkingState] interceptor that will
     * claim its redirect. Call this *before* launching the browser so a fast
     * redirect can't race ahead of the interceptor.
     */
    fun begin(sessionId: String, scheme: String, callback: Callback?) {
        cancelExisting()
        val session = Pending(sessionId, scheme, callback)
        synchronized(lock) { pending = session }
        val unsubscribe = LinkingState.addInterceptor { url -> claimRedirect(sessionId, url) }
        synchronized(lock) {
            if (pending === session) session.unsubscribe = unsubscribe else unsubscribe()
        }
    }

    /** Mark that the browser launched, arming cancel detection in [onHostResume]. */
    fun markLaunched(sessionId: String) {
        synchronized(lock) {
            pending?.takeIf { it.sessionId == sessionId }?.launched = true
        }
    }

    /** Called from `MainActivity.onResume` via [WebAuthActivityHook]. */
    fun onHostResume() {
        val session = synchronized(lock) { pending } ?: return
        if (session.launched && !session.finished) {
            finish(session.sessionId, canceledPayload())
        }
    }

    /** Programmatic abort (JS `AbortSignal`). The tab can't be force-closed,
     *  so we just settle the promise; the system tab returns on its own. */
    fun cancel(sessionId: String) {
        finish(sessionId, canceledPayload())
    }

    /** Resolve a session's JS callback exactly once and tear it down. */
    fun finish(sessionId: String, payload: JavaOnlyMap) {
        val session: Pending
        synchronized(lock) {
            val current = pending
            if (current == null || current.sessionId != sessionId || current.finished) return
            current.finished = true
            pending = null
            session = current
        }
        session.unsubscribe?.invoke()
        session.callback?.invoke(payload)
    }

    private fun claimRedirect(sessionId: String, url: String): Boolean {
        val scheme = try {
            Uri.parse(url).scheme
        } catch (e: Exception) {
            null
        } ?: return false
        val session = synchronized(lock) { pending } ?: return false
        if (session.sessionId != sessionId || session.finished) return false
        if (!scheme.equals(session.scheme, ignoreCase = true)) return false
        finish(sessionId, JavaOnlyMap().apply { putString("url", url) })
        return true
    }

    private fun cancelExisting() {
        val previous = synchronized(lock) { pending }
        if (previous != null && !previous.finished) {
            finish(previous.sessionId, canceledPayload())
        }
    }

    private fun canceledPayload(): JavaOnlyMap = JavaOnlyMap().apply { putBoolean("canceled", true) }
}
