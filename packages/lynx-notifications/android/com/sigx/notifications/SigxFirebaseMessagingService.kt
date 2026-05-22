package com.sigx.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
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

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        PushEventBus.publishToken(token, platform = "fcm")
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val notification = message.notification
        val title = notification?.title
        val body = notification?.body
        val data = message.data
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
        // Prefer the app's launcher icon over the stock dialog icon — Android
        // renders small-icons as monochrome silhouettes, so a generic system
        // shape would show up as a plain square. `applicationInfo.icon` is
        // the manifest <application android:icon>, which apps always set.
        val smallIcon = applicationInfo.icon.takeIf { it != 0 } ?: android.R.drawable.ic_dialog_info
        val builder = NotificationCompat.Builder(this, NotificationsModule.CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(smallIcon)
            .setAutoCancel(true)

        // Stash data on the launch intent so [PushActivityHook.onNewIntent]
        // can route the tap to [PushEventBus.publishResponse] / capture as
        // the cold-start payload.
        val pm = packageManager
        val launchIntent = pm.getLaunchIntentForPackage(packageName)?.apply {
            putExtra(PushActivityHook.EXTRA_NOTIFICATION_TAP, true)
            for ((k, v) in data) putExtra("sigx_push_data_$k", v)
        }
        val notificationId = (data["notification_id"] ?: data["notificationId"] ?: System.currentTimeMillis().toString())
        if (launchIntent != null) {
            val pending = android.app.PendingIntent.getActivity(
                this,
                notificationId.hashCode(),
                launchIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
            )
            builder.setContentIntent(pending)
        }

        manager.notify(notificationId.hashCode(), builder.build())
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
