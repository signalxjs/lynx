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
 *  - **cancel (back-out)** — the user dismisses the tab without redirecting.
 *    Only `onResume` fires then (no `onNewIntent`), and `onNewIntent` always
 *    runs *before* `onResume` on the success path — so a still-pending,
 *    already-launched session seen in [onHostResume] means the user backed out.
 *  - **cancel (programmatic `AbortSignal`)** — the app abandons the flow while
 *    the tab may still be open. We settle the promise as canceled immediately,
 *    but keep the interceptor alive in *swallow* mode so that if the user still
 *    completes the flow in the open tab, the late redirect is consumed (not
 *    re-published as a `Linking` deep link) — the interceptor is torn down on
 *    the next [onHostResume] (tab dismissed). Without this, the redirect would
 *    leak as a global deep-link event, reintroducing the very race this package
 *    avoids.
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
        /** Has the JS promise been settled (success/cancel/error)? */
        var resolved = false
        /** Has the browser been launched? Arms cancel detection in onHostResume. */
        var launched = false
        /**
         * Settled-as-canceled while the tab may still be open: keep consuming a
         * matching redirect (without re-resolving) until the next host resume.
         */
        var swallowing = false
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
        if (!session.launched) return
        when {
            // User backed out of the tab without redirecting → cancel + teardown.
            !session.resolved -> resolve(session.sessionId, canceledPayload(), tearDown = true)
            // We'd settled as canceled and were swallowing late redirects; the
            // tab is now gone (we're back) → stop swallowing, tear down.
            session.swallowing -> teardown(session.sessionId)
        }
    }

    /**
     * Programmatic abort (JS `AbortSignal`). The tab can't be force-closed, so
     * settle the promise as canceled but keep the interceptor swallowing a late
     * redirect until the tab is dismissed (next [onHostResume]).
     */
    fun cancel(sessionId: String) {
        resolve(sessionId, canceledPayload(), tearDown = false, swallow = true)
    }

    /** Resolve a session with a terminal payload and tear it down (used by the
     *  module for launch failures). */
    fun finish(sessionId: String, payload: JavaOnlyMap) {
        resolve(sessionId, payload, tearDown = true)
    }

    private fun claimRedirect(sessionId: String, url: String): Boolean {
        val scheme = try {
            Uri.parse(url).scheme
        } catch (e: Exception) {
            null
        } ?: return false
        val session = synchronized(lock) { pending } ?: return false
        if (session.sessionId != sessionId) return false
        if (!scheme.equals(session.scheme, ignoreCase = true)) return false
        if (!session.resolved) {
            // Normal success path.
            resolve(sessionId, JavaOnlyMap().apply { putString("url", url) }, tearDown = true)
            return true
        }
        // Already canceled but still swallowing: consume the late redirect so it
        // isn't published as a deep link, without resolving again.
        return session.swallowing
    }

    /**
     * Settle the pending session's callback exactly once, then optionally tear
     * down the interceptor (`tearDown`) or keep it alive in swallow mode
     * (`swallow`). The callback is invoked outside the lock.
     */
    private fun resolve(
        sessionId: String,
        payload: JavaOnlyMap,
        tearDown: Boolean,
        swallow: Boolean = false,
    ) {
        var callback: Callback? = null
        synchronized(lock) {
            val session = pending
            if (session == null || session.sessionId != sessionId) return
            if (!session.resolved) {
                session.resolved = true
                callback = session.callback
            }
            if (tearDown) {
                session.unsubscribe?.invoke()
                pending = null
            } else if (swallow) {
                session.swallowing = true
            }
        }
        callback?.invoke(payload)
    }

    private fun teardown(sessionId: String) {
        synchronized(lock) {
            val session = pending ?: return
            if (session.sessionId != sessionId) return
            session.unsubscribe?.invoke()
            pending = null
        }
    }

    private fun cancelExisting() {
        val previous = synchronized(lock) { pending } ?: return
        resolve(previous.sessionId, canceledPayload(), tearDown = true)
    }

    private fun canceledPayload(): JavaOnlyMap = JavaOnlyMap().apply { putBoolean("canceled", true) }
}
