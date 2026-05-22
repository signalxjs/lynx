package com.sigx.notifications

import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList

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

    private val listeners =
        CopyOnWriteArrayList<Pair<UUID, (String, JavaOnlyMap) -> Unit>>()

    /** Cached cold-start tap. Drained by [consumeInitialResponse]. */
    @Volatile private var initialResponse: JavaOnlyMap? = null

    /**
     * Cached last token so a JS subscriber that attaches after FCM has already
     * returned the token still sees the value on subscribe. FCM returns the
     * same token across calls until rotation.
     */
    @Volatile private var lastToken: JavaOnlyMap? = null

    fun addListener(fn: (String, JavaOnlyMap) -> Unit): UUID {
        val token = UUID.randomUUID()
        listeners.add(token to fn)
        lastToken?.let { fn(Channel.TOKEN, it) }
        return token
    }

    fun removeListener(token: UUID) {
        listeners.removeAll { it.first == token }
    }

    fun publishToken(token: String, platform: String = "fcm") {
        val payload = JavaOnlyMap().apply {
            putString("token", token)
            putString("platform", platform)
        }
        lastToken = payload
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
        initialResponse = JavaOnlyMap().apply {
            putString("notificationId", notificationId)
            putMap("data", data.toJavaOnlyMap())
            putString("actionIdentifier", actionIdentifier)
        }
    }

    /** One-shot drain. */
    fun consumeInitialResponse(): JavaOnlyMap? {
        val p = initialResponse
        initialResponse = null
        return p
    }

    private fun emit(channel: String, payload: JavaOnlyMap) {
        for ((_, fn) in listeners) fn(channel, payload)
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
