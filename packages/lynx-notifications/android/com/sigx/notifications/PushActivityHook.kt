package com.sigx.notifications

import android.app.Activity
import android.content.Intent
import android.os.Bundle

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
 * The launch intent is populated by [SigxFirebaseMessagingService]
 * (`EXTRA_NOTIFICATION_TAP` + `sigx_push_data_*` extras). Local notifications
 * scheduled via [NotificationsModule.schedule] don't currently set this flag
 * (they show via the system manager directly), so local-tap routing on Android
 * lands here only when scheduled with a launch intent — TODO for v2.
 */
object PushActivityHook {

    const val EXTRA_NOTIFICATION_TAP = "sigx_notification_tap"

    @JvmStatic
    fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
        val intent = activity.intent ?: return
        if (intent.getBooleanExtra(EXTRA_NOTIFICATION_TAP, false)) {
            val (id, data) = extractPayload(intent)
            PushEventBus.captureInitialResponse(
                notificationId = id,
                data = data,
                actionIdentifier = "default",
            )
        }
    }

    @JvmStatic
    fun onNewIntent(activity: Activity, intent: Intent) {
        if (!intent.getBooleanExtra(EXTRA_NOTIFICATION_TAP, false)) return
        val (id, data) = extractPayload(intent)
        PushEventBus.publishResponse(
            notificationId = id,
            data = data,
            actionIdentifier = "default",
        )
    }

    private fun extractPayload(intent: Intent): Pair<String, Map<String, String>> {
        val data = mutableMapOf<String, String>()
        val extras = intent.extras ?: return "" to data
        for (key in extras.keySet()) {
            if (!key.startsWith("sigx_push_data_")) continue
            val short = key.removePrefix("sigx_push_data_")
            val v = extras.getString(key) ?: continue
            data[short] = v
        }
        val id = data["notification_id"]
            ?: data["notificationId"]
            ?: java.util.UUID.randomUUID().toString()
        return id to data
    }
}
