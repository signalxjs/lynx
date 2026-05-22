package com.sigx.notifications

import android.app.NotificationManager
import android.content.Context
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
 *   - [onMessageReceived]: incoming push. If the payload carries a
 *     `notification` block (the FCM "notification message" shape), the system
 *     would normally auto-display it ONLY when the app is backgrounded —
 *     foreground deliveries land here as `data` only. We forward to JS
 *     regardless and also pop a local notification when the payload includes
 *     a title/body so foreground apps still get a banner.
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
}
