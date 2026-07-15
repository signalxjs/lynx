package com.sigx.notifications

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log
import com.google.firebase.messaging.RemoteMessage
import java.util.UUID

/**
 * Activity-lifecycle hook for push notifications. Discovered by the auto-linker
 * via `signalx-module.json`'s `android.activityHook` field.
 *
 * Responsibilities:
 *   - `onCreate`: app cold-started by a notification tap → stash the payload
 *     for [PushEventBus.captureInitialResponse] so JS can read it via
 *     `Notifications.getInitialNotification()`.
 *   - `onNewIntent`: app foregrounded by a tap while alive → publish to JS
 *     immediately via [PushEventBus.publishResponse].
 *
 * Two tap sources land here, and they are mutually exclusive per message:
 *
 *  1. **Ours.** [SigxFirebaseMessagingService] posted the tray entry for a
 *     data-only message and built the tap intent itself
 *     ([EXTRA_NOTIFICATION_TAP] + `sigx_push_data_*` extras).
 *  2. **FCM's.** The message carried a `notification` block and the app was
 *     backgrounded/terminated, so FCM never called `onMessageReceived` — the OS
 *     rendered the tray entry and owns the tap intent. That intent carries the
 *     sender's `data` keys as flat String extras alongside FCM's own transport
 *     metadata. We detect it via [EXTRA_FCM_MESSAGE_ID] and harvest the data
 *     keys back out with [extractFcmData] (#619).
 *
 * (2) is a *degradation* path, not the supported one. We don't control that
 * intent's flags, and FCM builds it from `getLaunchIntentForPackage()` — the
 * same construction that broke our own warm taps (see
 * [SigxFirebaseMessagingService.buildTapIntent]) — so it reliably recovers the
 * COLD-START payload but a warm tap may never be delivered at all. Senders
 * wanting dependable tap routing on Android should use data-only messages; see
 * the README's message-shape matrix.
 *
 * Local notifications scheduled via [NotificationsModule.schedule] don't set a
 * contentIntent, so local-tap routing on Android still lands nowhere — TODO v2.
 */
object PushActivityHook {

    private const val TAG = "SigxPushActivityHook"

    const val EXTRA_NOTIFICATION_TAP = "sigx_notification_tap"

    /** Namespace for the data extras we stash on our own tap intents. */
    const val SIGX_DATA_PREFIX = "sigx_push_data_"

    /**
     * `Constants.MessagePayloadKeys.MSGID`. FCM sets it as transport metadata on
     * every message, and `NotificationParams.isReservedKey` (which strips only
     * `google.c.` / `gcm.n.` / `gcm.notification.` from the click intent)
     * provably leaves it in place — so its presence is a sound "this launch came
     * from an FCM notification tap" signal. react-native-firebase, Capacitor and
     * cordova-plugin-firebasex all gate on exactly this key.
     */
    private const val EXTRA_FCM_MESSAGE_ID = "google.message_id"

    /** Pre-v1 alias of [EXTRA_FCM_MESSAGE_ID]; still read as an id fallback. */
    private const val EXTRA_FCM_MESSAGE_ID_LEGACY = "message_id"

    /** Our own extras namespace — see [stripSigxKeys]. */
    private const val SIGX_PREFIX = "sigx_"

    @JvmStatic
    fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
        // A recreate (rotation, theme/locale change) re-runs onCreate against
        // the SAME launch intent. Without this guard the tap payload is
        // re-stashed after JS already drained it via getInitialNotification(),
        // and the app deep-links a second time. A genuine cold-start-from-tap
        // always has a null bundle, so this never suppresses a real tap.
        if (savedInstanceState != null) return
        val intent = activity.intent ?: return
        if (!isNotificationTap(intent)) return
        val (id, data) = extractPayload(intent)
        consume(intent)
        logTap("cold-start", id, data)
        PushEventBus.captureInitialResponse(
            notificationId = id,
            data = data,
            actionIdentifier = "default",
        )
    }

    @JvmStatic
    fun onNewIntent(activity: Activity, intent: Intent) {
        if (!isNotificationTap(intent)) return
        val (id, data) = extractPayload(intent)
        // MainActivity calls setIntent(intent), so this intent becomes
        // activity.intent — clear the markers here too, or a later recreate
        // would re-deliver it through onCreate.
        consume(intent)
        logTap("warm", id, data)
        PushEventBus.publishResponse(
            notificationId = id,
            data = data,
            actionIdentifier = "default",
        )
    }

    /**
     * Trace a routed tap. Logs the notification id and the data KEYS only —
     * never the values, which are app payload and routinely carry user data.
     * Enough to tell "the tap arrived and carried `route`" from "the payload
     * was lost", which is the failure this module kept hitting silently (#619).
     */
    private fun logTap(kind: String, id: String, data: Map<String, String>) {
        Log.d(TAG, "$kind tap routed: id=$id, data keys=${data.keys.sorted()}")
    }

    private fun isNotificationTap(intent: Intent): Boolean =
        intent.getBooleanExtra(EXTRA_NOTIFICATION_TAP, false) ||
            intent.hasExtra(EXTRA_FCM_MESSAGE_ID)

    /**
     * Strip the markers so one tap is delivered exactly once.
     *
     * Note this cannot defend against process-death restore-from-recents: the
     * system rebuilds the Activity from the *persisted* task intent, a fresh
     * object that never saw this mutation. The [onCreate] savedInstanceState
     * guard covers the in-process recreates, which is every case we can reach.
     */
    private fun consume(intent: Intent) {
        intent.removeExtra(EXTRA_NOTIFICATION_TAP)
        intent.removeExtra(EXTRA_FCM_MESSAGE_ID)
    }

    private fun extractPayload(intent: Intent): Pair<String, Map<String, String>> {
        val extras = intent.extras ?: return "" to emptyMap()
        // Prefer our own namespaced extras; fall back to FCM's flat bundle.
        // Ordered, so the two sources can never merge: our intents never carry
        // google.message_id, and FCM's never carry sigx_push_data_*.
        val data = extractSigxData(extras).ifEmpty { extractFcmData(extras) }
        val id = data["notification_id"]
            ?: data["notificationId"]
            // An OS-rendered notification carries no id of ours — FCM's message
            // id is the only stable handle, and it's what the sender sees in the
            // FCM v1 send response.
            ?: extras.getString(EXTRA_FCM_MESSAGE_ID)
            ?: extras.getString(EXTRA_FCM_MESSAGE_ID_LEGACY)
            ?: UUID.randomUUID().toString()
        return id to data
    }

    private fun extractSigxData(extras: Bundle): Map<String, String> {
        val data = mutableMapOf<String, String>()
        for (key in extras.keySet()) {
            if (!key.startsWith(SIGX_DATA_PREFIX)) continue
            val v = extras.getString(key) ?: continue
            data[key.removePrefix(SIGX_DATA_PREFIX)] = v
        }
        return data
    }

    /**
     * Harvest the sender's `data` keys out of an intent FCM built.
     *
     * The filter is delegated to `RemoteMessage.getData()`
     * (`MessagePayloadKeys.extractDeveloperDefinedPayload`), which drops the
     * `google.` / `gcm.` prefixes plus `from` / `message_type` /
     * `collapse_key`, and skips non-String values — so the Long `google.sent_time`
     * and Int `google.ttl` can't reach us as garbage. Delegating rather than
     * hand-rolling a denylist means Google's reserved set stays authoritative as
     * it evolves; `RemoteMessage(Bundle)` is public and is exactly what
     * react-native-firebase and flutterfire use on this path.
     *
     * Worth knowing: the click intent's own filter is NARROWER than
     * `getData()`'s — `NotificationParams.isReservedKey` strips only `google.c.`
     * / `gcm.n.` / `gcm.notification.`, so `from`, `collapse_key`,
     * `google.message_id`, `google.sent_time` and the priority keys DO ride
     * along on the intent. `getData()` is a safe superset of both.
     */
    private fun extractFcmData(extras: Bundle): Map<String, String> =
        stripSigxKeys(RemoteMessage(extras).data)

    /**
     * `getData()` only knows FCM's reserved words, not ours. A dev-client launch
     * carries `sigx_dev_url` (`MainActivity.EXTRA_DEV_URL`) and our own taps
     * carry `sigx_notification_tap`; neither is sender data, so drop the
     * namespace wholesale rather than leak it into `data`.
     */
    private fun stripSigxKeys(data: Map<String, String>): Map<String, String> =
        data.filterKeys { !it.startsWith(SIGX_PREFIX) }
}
