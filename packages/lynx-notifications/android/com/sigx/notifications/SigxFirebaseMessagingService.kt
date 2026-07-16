package com.sigx.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * FCM entry point. Registered in AndroidManifest via the auto-linker
 * (`android.services` in `signalx-module.json`).
 *
 * Handles two callbacks:
 *   - [onNewToken]: token rotated. Forwarded to JS via [PushEventBus] so the
 *     app can re-register with its backend (Azure Notification Hubs, etc.).
 *   - [onMessageReceived]: incoming push. Forwarded to JS regardless of app
 *     state. When the app is BACKGROUNDED and the payload carries a
 *     title/body, we additionally pop a system notification so the user has
 *     a visible entry point back into the app — without this, FCM data-only
 *     messages received while backgrounded silently land in JS but never
 *     surface in the system tray. When the app is foreground, we skip the
 *     system notif: the JS heap is alive and apps are expected to render
 *     their own in-app UI from `addPushListener`.
 */
class SigxFirebaseMessagingService : FirebaseMessagingService() {

    companion object {
        /** Messages kept per conversation — the platform renders at most ~7. */
        const val MAX_MESSAGING_HISTORY = 7
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        PushEventBus.publishToken(token, platform = "fcm")
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val notification = message.notification
        val data = message.data
        // Display fields fall back to the `data` map. FCM only calls
        // onMessageReceived for a backgrounded/terminated app when the message
        // is DATA-ONLY — a message carrying a `notification` block is rendered
        // by the OS and never reaches us. So data-only is the one shape that
        // reliably delivers a payload in the background, and a data-only
        // message has `message.notification == null`: reading title/body
        // solely from the notification block meant the only shape that works
        // for delivery produced no tray entry at all (#619).
        //
        // Fields sourced from `data` stay in `data` too — an app that keys off
        // `data.title` shouldn't find it missing just because we also used it
        // for the tray entry.
        val title = notification?.title ?: data["title"]
        val body = notification?.body ?: data["body"]
        // foreground=true here is "the JS heap is alive". FCM service runs
        // regardless of activity foreground state, but the JS shim and apps
        // typically treat `foreground` as "received while app was in use" —
        // we approximate by checking the process importance.
        val foreground = isAppInForeground()
        PushEventBus.publishMessage(
            title = title,
            body = body,
            data = data,
            foreground = foreground,
        )

        if (!foreground && title != null) {
            showSystemNotification(title, body ?: "", data)
        }
    }

    private fun isAppInForeground(): Boolean {
        val appProcessInfo = android.app.ActivityManager.RunningAppProcessInfo()
        android.app.ActivityManager.getMyMemoryState(appProcessInfo)
        return appProcessInfo.importance == android.app.ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND ||
            appProcessInfo.importance == android.app.ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE
    }

    private fun showSystemNotification(title: String, body: String, data: Map<String, String>) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // The FCM service can fire BEFORE NotificationsModule is ever
        // instantiated (the JS bridge may not have loaded yet — particularly
        // for data-only messages that wake the app from a fully terminated
        // state). Ensure the notification channel exists here too so
        // `notify()` on O+ doesn't silently drop the post.
        ensureChannel(manager)
        val builder = NotificationCompat.Builder(this, NotificationsModule.CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(NotificationAppearance.smallIcon(this))
            .setAutoCancel(true)
        NotificationAppearance.accentColor(this)?.let { builder.setColor(it) }

        val notificationId = (data["notification_id"] ?: data["notificationId"] ?: System.currentTimeMillis().toString())

        if (data["style"] == "messaging") {
            applyMessagingStyle(manager, builder, notificationId, title, body, data)
        }

        buildTapIntent(data)?.let { tapIntent ->
            // FLAG_UPDATE_CURRENT matters: PendingIntent equality ignores
            // extras, so two notifications sharing a request code would
            // otherwise replay the FIRST one's payload.
            val pending = android.app.PendingIntent.getActivity(
                this,
                notificationId.hashCode(),
                tapIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
            )
            builder.setContentIntent(pending)
        }

        val group = data["group"]
        group?.let { builder.setGroup(it) }

        manager.notify(notificationId.hashCode(), builder.build())

        group?.let { showGroupSummary(manager, it) }
    }

    /**
     * Conversation-style stacking (`data.style == "messaging"`): render with
     * [NotificationCompat.MessagingStyle] and ACCUMULATE — each push under the
     * same `data.notification_id` appends a line (sender + message) to the
     * existing tray entry instead of replacing its body, so earlier messages
     * stay visible. History is carried across posts by extracting the style
     * from the currently active notification (the tray is the storage — no
     * state of our own survives process death anyway) and capped at
     * [MAX_MESSAGING_HISTORY], the platform's visible maximum.
     *
     * Requires `activeNotifications` (API 23); below M the entry silently
     * stays replace-in-place, today's behavior.
     */
    private fun applyMessagingStyle(
        manager: NotificationManager,
        builder: NotificationCompat.Builder,
        notificationId: String,
        title: String,
        body: String,
        data: Map<String, String>,
    ) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return

        val existingStyle = manager.activeNotifications
            .firstOrNull { it.id == notificationId.hashCode() }
            ?.let { NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(it.notification) }

        val sender = Person.Builder()
            .setName(data["sender_name"] ?: data["senderName"] ?: title)
            .build()
        val messages =
            (existingStyle?.messages ?: emptyList()) +
                NotificationCompat.MessagingStyle.Message(body, System.currentTimeMillis(), sender)

        // MessagingStyle requires a "user" Person (the device owner); it only
        // renders for messages attributed to the user, which we never add.
        // Use the app label rather than a hard-coded English string in case a
        // launcher surfaces it anyway.
        val style = NotificationCompat.MessagingStyle(Person.Builder().setName(appLabel()).build())
        val conversationTitle = data["conversation_title"]
            ?: data["conversationTitle"]
            ?: existingStyle?.conversationTitle?.toString()
        conversationTitle?.let {
            style.setConversationTitle(it)
            // Since P the platform ignores the title unless the style is
            // marked a group conversation.
            style.setGroupConversation(true)
        }
        for (message in messages.takeLast(MAX_MESSAGING_HISTORY)) style.addMessage(message)
        builder.setStyle(style)
    }

    /**
     * Group-summary entry for `data.group`: bundles the group's conversation
     * notifications under one expandable tray group (the standard Inbox
     * pattern). Posted under `group.hashCode()` — the same id space as
     * `notification_id`, so `Notifications.cancel(group)` dismisses it.
     * Re-posting on every push is idempotent (same id, same content).
     *
     * The summary's tap intent carries no payload and no tap extra — it just
     * opens the app; per-conversation routing belongs to the child entries.
     */
    private fun showGroupSummary(manager: NotificationManager, group: String) {
        val builder = NotificationCompat.Builder(this, NotificationsModule.CHANNEL_ID)
            // A summary without a title renders as a blank row on some
            // devices; the app label is a neutral, localized header.
            .setContentTitle(appLabel())
            .setSmallIcon(NotificationAppearance.smallIcon(this))
            .setAutoCancel(true)
            .setGroup(group)
            .setGroupSummary(true)
            // The summary is re-posted on every push under the same id; the
            // children carry the alert, the summary must stay silent.
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .setOnlyAlertOnce(true)
        NotificationAppearance.accentColor(this)?.let { builder.setColor(it) }
        buildLaunchIntent()?.let { intent ->
            val pending = android.app.PendingIntent.getActivity(
                this,
                group.hashCode(),
                intent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
            )
            builder.setContentIntent(pending)
        }
        manager.notify(group.hashCode(), builder.build())
    }

    /**
     * Tap intent for a notification we posted ourselves. Stashes the payload
     * so [PushActivityHook] can route the tap to [PushEventBus.publishResponse]
     * (warm) or capture it as the cold-start payload.
     *
     * Deliberately NOT `getLaunchIntentForPackage()`'s intent as-is: that is an
     * ACTION_MAIN/CATEGORY_LAUNCHER intent, and starting one against an
     * already-running task is treated as a *launcher relaunch* — the task is
     * brought to the front and the intent is never delivered, so the extras
     * evaporate and `onNewIntent` never fires. Warm taps silently lost the
     * payload. We reuse it only to RESOLVE the launcher component, then build a
     * plain explicit intent.
     *
     * Flags:
     *  - NEW_TASK: mandatory — the PendingIntent fires from outside an Activity.
     *  - CLEAR_TOP + SINGLE_TOP: reuse the existing MainActivity and deliver via
     *    `onNewIntent` rather than stacking a second instance (a second LynxView
     *    and JS heap). SINGLE_TOP is set explicitly rather than leaning on the
     *    template's `launchMode="singleTop"`, so an app that changes launchMode
     *    to `standard` still gets `onNewIntent` instead of a destroy/recreate.
     *
     * Trade-off: CLEAR_TOP finishes any activities the host app stacked ABOVE
     * MainActivity. For a Lynx app the whole UI is one Activity and "take me to
     * the notification target" is the tap's semantic, so that's the intent — but
     * an app with extra native activities will see them dismissed. SINGLE_TOP
     * alone is worse: if MainActivity isn't on top, a duplicate is created.
     */
    private fun buildTapIntent(data: Map<String, String>): Intent? {
        return buildLaunchIntent()?.apply {
            putExtra(PushActivityHook.EXTRA_NOTIFICATION_TAP, true)
            for ((k, v) in data) putExtra("${PushActivityHook.SIGX_DATA_PREFIX}$k", v)
        }
    }

    private fun appLabel(): String = applicationInfo.loadLabel(packageManager).toString()

    /** Bare launcher intent (see [buildTapIntent] for the flag rationale) — no payload extras. */
    private fun buildLaunchIntent(): Intent? {
        val component = packageManager
            .getLaunchIntentForPackage(packageName)
            ?.component
            ?: return null
        return Intent().apply {
            setComponent(component)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
    }

    private fun ensureChannel(manager: NotificationManager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        if (manager.getNotificationChannel(NotificationsModule.CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            NotificationsModule.CHANNEL_ID,
            "sigx-lynx-go",
            NotificationManager.IMPORTANCE_DEFAULT,
        )
        manager.createNotificationChannel(channel)
    }
}
