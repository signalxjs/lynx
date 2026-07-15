package com.sigx.notifications

import org.json.JSONObject
import java.util.UUID

/**
 * Process-wide pub/sub bus that converts FCM + notification-tap callbacks
 * into JS-side event payloads. [SigxFirebaseMessagingService] and
 * [PushActivityHook] write here; per-LynxView [PushPublisher] instances read.
 *
 * Mirrors the [com.sigx.websocket.WebSocketEventBus] pattern. Decoupled from
 * any specific LynxView so events that fire before the JS heap is ready
 * (cold-start taps, async token refresh) survive view recreation.
 *
 * Payloads are emitted as a **JSON string** whose parsed shape matches the
 * interfaces in `src/push.ts`. A string (rather than a structured
 * `JavaOnlyMap`) survives Lynx 0.5.0's bridge marshalling intact — a map
 * carrying a nested map drops its *sibling scalar* fields crossing the bridge
 * (#342), and every payload here nests `data`. That silently ate `title` /
 * `body` / `foreground` / `notificationId` / `actionIdentifier` from every
 * push event while `data` arrived intact — which is why the bug read as "the
 * data is there but tap routing does nothing". Same fix, same reason as
 * `HttpEventBus` / `WebRTCEventBus`; the JS shim already parses string-form
 * events.
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
    private val listeners = mutableListOf<Pair<UUID, (String, String) -> Unit>>()

    /** Cached cold-start tap, JSON-encoded. Drained by [consumeInitialResponse]. */
    private var initialResponse: String? = null

    /**
     * Cached last token so a JS subscriber that attaches after FCM has already
     * returned the token still sees the value on subscribe. FCM returns the
     * same token across calls until rotation.
     */
    private var lastToken: String? = null

    fun addListener(fn: (String, String) -> Unit): UUID {
        val token = UUID.randomUUID()
        // Snapshot the cached token in the same critical section as the
        // listener append — without this, a concurrent publishToken can slip
        // between `listeners.add` and reading `lastToken`, causing the new
        // listener to fire twice (once from the publish, once from the
        // replay). Matches the iOS bus' semantics.
        val cached: String?
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
        val json = JSONObject()
            .put("token", token)
            .put("platform", platform)
            .toString()
        synchronized(lock) { lastToken = json }
        emit(Channel.TOKEN, json)
    }

    fun publishTokenError(message: String) {
        emit(Channel.TOKEN_ERROR, JSONObject().put("error", message).toString())
    }

    fun publishMessage(
        title: String?,
        body: String?,
        data: Map<String, String>,
        foreground: Boolean,
    ) {
        val obj = JSONObject()
        // Omit rather than null-fill: `title`/`body` are optional in
        // `RemoteMessage` (`src/push.ts`), and a data-only message with no
        // `data["title"]` legitimately has neither.
        if (title != null) obj.put("title", title)
        if (body != null) obj.put("body", body)
        obj.put("data", data.toJson())
        obj.put("foreground", foreground)
        emit(Channel.MESSAGE, obj.toString())
    }

    fun publishResponse(
        notificationId: String,
        data: Map<String, String>,
        actionIdentifier: String,
    ) {
        emit(Channel.RESPONSE, responseJson(notificationId, data, actionIdentifier))
    }

    /** Stash a cold-start tap until JS calls `getInitialNotification`. */
    fun captureInitialResponse(
        notificationId: String,
        data: Map<String, String>,
        actionIdentifier: String,
    ) {
        val json = responseJson(notificationId, data, actionIdentifier)
        synchronized(lock) { initialResponse = json }
    }

    /** One-shot drain. JSON string — the JS shim parses it. */
    fun consumeInitialResponse(): String? {
        return synchronized(lock) {
            val p = initialResponse
            initialResponse = null
            p
        }
    }

    private fun responseJson(
        notificationId: String,
        data: Map<String, String>,
        actionIdentifier: String,
    ): String = JSONObject()
        .put("notificationId", notificationId)
        .put("data", data.toJson())
        .put("actionIdentifier", actionIdentifier)
        .toString()

    private fun emit(channel: String, json: String) {
        // Snapshot under the lock so a concurrent add/remove can't tear the
        // iteration. Call listeners OUTSIDE the lock so a callback that
        // re-enters the bus doesn't deadlock.
        val snapshot = synchronized(lock) { listeners.toList() }
        for ((_, fn) in snapshot) fn(channel, json)
    }

    private fun Map<String, String>.toJson(): JSONObject {
        val o = JSONObject()
        for ((k, v) in this) o.put(k, v)
        return o
    }

    object Channel {
        const val TOKEN = "__sigxPushToken"
        const val TOKEN_ERROR = "__sigxPushTokenError"
        const val MESSAGE = "__sigxPushMessage"
        const val RESPONSE = "__sigxNotificationResponse"
    }
}
