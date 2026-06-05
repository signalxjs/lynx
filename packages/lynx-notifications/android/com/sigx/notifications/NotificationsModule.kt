package com.sigx.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.android.gms.tasks.OnCompleteListener
import com.google.firebase.messaging.FirebaseMessaging
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.sigx.permissions.PermissionHelper
import com.lynx.react.bridge.ReadableMap
import java.util.UUID

/**
 * Local + remote notifications module.
 * JS usage: NativeModules.Notifications.<method>(...)
 */
class NotificationsModule(context: Context) : LynxModule(context) {

    companion object {
        private const val TAG = "NotificationsModule"
        internal const val CHANNEL_ID = "sigx_lynxgo_default"
        private const val CHANNEL_NAME = "sigx-lynx-go"
    }

    init {
        createNotificationChannel()
    }

    @LynxMethod
    fun schedule(content: ReadableMap?, options: ReadableMap?, callback: Callback?) {
        try {
            val title = content?.getString("title") ?: "Notification"
            val body = content?.getString("body") ?: ""
            val notificationId = UUID.randomUUID().toString()

            val manager = mContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            val builder = NotificationCompat.Builder(mContext, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(body)
                .setSmallIcon(NotificationAppearance.smallIcon(mContext))
                .setAutoCancel(true)
            NotificationAppearance.accentColor(mContext)?.let { builder.setColor(it) }
            val notification = builder.build()

            manager.notify(notificationId.hashCode(), notification)
            callback?.invoke(notificationId)
            Log.d(TAG, "Notification scheduled: $notificationId")
        } catch (e: Exception) {
            val error = JavaOnlyMap()
            error.putString("error", e.message ?: "Unknown error")
            callback?.invoke(error)
        }
    }

    @LynxMethod
    fun cancel(notificationId: String?, callback: Callback?) {
        try {
            val manager = mContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.cancel((notificationId ?: "").hashCode())
            callback?.invoke(true)
        } catch (e: Exception) {
            callback?.invoke(false)
        }
    }

    @LynxMethod
    fun cancelAll(callback: Callback?) {
        try {
            val manager = mContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.cancelAll()
            callback?.invoke(true)
        } catch (e: Exception) {
            callback?.invoke(false)
        }
    }

    @LynxMethod
    fun requestPermission(callback: Callback?) {
        PermissionHelper.requestPermission(mContext, "notifications") { result ->
            callback?.invoke(result)
        }
    }

    @LynxMethod
    fun getPermissionStatus(callback: Callback?) {
        val result = PermissionHelper.checkPermission(mContext, "notifications")
        callback?.invoke(result)
    }

    // ── Remote push ──────────────────────────────────────────────────────────

    /**
     * Resolve the FCM token. Unlike iOS where APNs delivery is async via
     * AppDelegate, FCM exposes a Task<String> we can await directly. We still
     * publish to [PushEventBus] (for the global event channel) so consumers
     * using `addTokenListener` see the same value.
     */
    @LynxMethod
    fun registerForPushNotifications(callback: Callback?) {
        try {
            FirebaseMessaging.getInstance().token.addOnCompleteListener(OnCompleteListener { task ->
                if (!task.isSuccessful) {
                    val message = task.exception?.localizedMessage ?: "FCM token unavailable"
                    PushEventBus.publishTokenError(message)
                    val err = JavaOnlyMap().apply { putString("error", message) }
                    callback?.invoke(err)
                    return@OnCompleteListener
                }
                val token = task.result ?: ""
                PushEventBus.publishToken(token, platform = "fcm")
                val payload = JavaOnlyMap().apply {
                    putString("token", token)
                    putString("platform", "fcm")
                }
                callback?.invoke(payload)
            })
        } catch (e: Throwable) {
            // Firebase not initialised (no google-services.json). Surface a
            // clean error instead of letting the bridge spam an uncaught.
            val message = "FCM unavailable: ${e.message ?: e.javaClass.simpleName}"
            PushEventBus.publishTokenError(message)
            callback?.invoke(JavaOnlyMap().apply { putString("error", message) })
        }
    }

    /**
     * Awaits the FCM `deleteToken()` Task. Callers get an `{ ok, error? }`
     * back so the JS shim can tell whether the device is genuinely
     * unregistered or still holding a token server-side.
     */
    @LynxMethod
    fun unregisterForPushNotifications(callback: Callback?) {
        try {
            FirebaseMessaging.getInstance().deleteToken()
                .addOnCompleteListener(OnCompleteListener { task ->
                    if (task.isSuccessful) {
                        callback?.invoke(JavaOnlyMap().apply { putBoolean("ok", true) })
                    } else {
                        val message = task.exception?.localizedMessage
                            ?: "Failed to delete FCM token"
                        PushEventBus.publishTokenError(message)
                        callback?.invoke(JavaOnlyMap().apply {
                            putBoolean("ok", false)
                            putString("error", message)
                        })
                    }
                })
        } catch (e: Throwable) {
            val message = "FCM unavailable: ${e.message ?: e.javaClass.simpleName}"
            PushEventBus.publishTokenError(message)
            callback?.invoke(JavaOnlyMap().apply {
                putBoolean("ok", false)
                putString("error", message)
            })
        }
    }

    /**
     * No-op on Android. Stock Android has no portable app-icon badging API
     * (it's vendor-specific: Samsung's `ShortcutBadger`, etc.) and we
     * intentionally don't wipe pending notifications on setBadgeCount(0) —
     * the call's name promises "set a badge", not "clear notifications".
     * Callers wanting to clear notifications should use `cancelAll()` directly.
     */
    @LynxMethod
    fun setBadgeCount(count: Int, callback: Callback?) {
        callback?.invoke(true)
    }

    @LynxMethod
    fun getBadgeCount(callback: Callback?) {
        // No portable read API. Always return 0; documented in README.
        callback?.invoke(0)
    }

    /**
     * One-shot: drain the cold-start tap payload, or null.
     * Marshals JavaOnlyMap → callback so JS sees the same shape as remote events.
     */
    @LynxMethod
    fun getInitialNotification(callback: Callback?) {
        val payload = PushEventBus.consumeInitialResponse()
        if (payload == null) {
            callback?.invoke(null as Any?)
        } else {
            callback?.invoke(payload)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT
            )
            val manager = mContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }
}
