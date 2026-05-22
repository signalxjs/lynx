package com.sigx.notifications

import com.lynx.react.bridge.JavaOnlyMap
import java.util.UUID

/**
 * Process-wide pub/sub bus that converts FCM + notification-tap callbacks
 * into JS-side event payloads. [SigxFirebaseMessagingService] and
 * [PushActivityHook] write here; per-LynxView [PushPublisher] instances read.
 *
 * Mirrors the [com.sigx.websocket.WebSocketEventBus] pattern. Decoupled from
 * any specific LynxView so events that fire before the JS heap is ready
 * (cold-start taps, async token refresh) survive view recreation.
 */
internal object PushEventBus {

    /**
     * Single lock guards [listeners] + [lastToken] + [initialResponse]. We
     * use a private monitor object so external code can't accidentally
     * acquire our lock and deadlock the bus.
     *
     * All listener invocations happen OUTSIDE the lock — a listener that
     * publishes recursively (e.g. attaches another listener inside its
     * callback) must not deadlock.
     */
    private val lock = Any()
    private val listeners = mutableListOf<Pair<UUID, (String, JavaOnlyMap) -> Unit>>()

    /** Cached cold-start tap. Drained by [consumeInitialResponse]. */
    private var initialResponse: JavaOnlyMap? = null

    /**
     * Cached last token so a JS subscriber that attaches after FCM has already
     * returned the token still sees the value on subscribe. FCM returns the
     * same token across calls until rotation.
     */
    private var lastToken: JavaOnlyMap? = null

    fun addListener(fn: (String, JavaOnlyMap) -> Unit): UUID {
        val token = UUID.randomUUID()
        // Snapshot the cached token in the same critical section as the
        // listener append — without this, a concurrent publishToken can slip
        // between `listeners.add` and reading `lastToken`, causing the new
        // listener to fire twice (once from the publish, once from the
        // replay). Matches the iOS bus' semantics.
        val cached: JavaOnlyMap?
        synchronized(lock) {
            listeners.add(token to fn)
            cached = lastToken
        }
        cached?.let { fn(Channel.TOKEN, it) }
        return token
    }

    fun removeListener(token: UUID) {
        synchronized(lock) {
            listeners.removeAll { it.first == token }
        }
    }

    fun publishToken(token: String, platform: String = "fcm") {
        val payload = JavaOnlyMap().apply {
            putString("token", token)
            putString("platform", platform)
        }
        synchronized(lock) { lastToken = payload }
        emit(Channel.TOKEN, payload)
    }

    fun publishTokenError(message: String) {
        emit(
            Channel.TOKEN_ERROR,
            JavaOnlyMap().apply { putString("error", message) },
        )
    }

    fun publishMessage(
        title: String?,
        body: String?,
        data: Map<String, String>,
        foreground: Boolean,
    ) {
        val payload = JavaOnlyMap().apply {
            if (title != null) putString("title", title)
            if (body != null) putString("body", body)
            putMap("data", data.toJavaOnlyMap())
            putBoolean("foreground", foreground)
        }
        emit(Channel.MESSAGE, payload)
    }

    fun publishResponse(
        notificationId: String,
        data: Map<String, String>,
        actionIdentifier: String,
    ) {
        val payload = JavaOnlyMap().apply {
            putString("notificationId", notificationId)
            putMap("data", data.toJavaOnlyMap())
            putString("actionIdentifier", actionIdentifier)
        }
        emit(Channel.RESPONSE, payload)
    }

    /** Stash a cold-start tap until JS calls `getInitialNotification`. */
    fun captureInitialResponse(
        notificationId: String,
        data: Map<String, String>,
        actionIdentifier: String,
    ) {
        val payload = JavaOnlyMap().apply {
            putString("notificationId", notificationId)
            putMap("data", data.toJavaOnlyMap())
            putString("actionIdentifier", actionIdentifier)
        }
        synchronized(lock) { initialResponse = payload }
    }

    /** One-shot drain. */
    fun consumeInitialResponse(): JavaOnlyMap? {
        return synchronized(lock) {
            val p = initialResponse
            initialResponse = null
            p
        }
    }

    private fun emit(channel: String, payload: JavaOnlyMap) {
        // Snapshot under the lock so a concurrent add/remove can't tear the
        // iteration. Call listeners OUTSIDE the lock so a callback that
        // re-enters the bus doesn't deadlock.
        val snapshot = synchronized(lock) { listeners.toList() }
        for ((_, fn) in snapshot) fn(channel, payload)
    }

    private fun Map<String, String>.toJavaOnlyMap(): JavaOnlyMap {
        val m = JavaOnlyMap()
        for ((k, v) in this) m.putString(k, v)
        return m
    }

    object Channel {
        const val TOKEN = "__sigxPushToken"
        const val TOKEN_ERROR = "__sigxPushTokenError"
        const val MESSAGE = "__sigxPushMessage"
        const val RESPONSE = "__sigxNotificationResponse"
    }
}
