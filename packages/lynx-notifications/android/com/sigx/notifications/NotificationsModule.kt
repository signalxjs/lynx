package com.sigx.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.sigx.permissions.PermissionHelper
import com.lynx.react.bridge.ReadableMap
import java.util.UUID

/**
 * Local notifications module.
 * JS usage: NativeModules.Notifications.schedule({ title, body }, { delay }, callback)
 */
class NotificationsModule(context: Context) : LynxModule(context) {

    companion object {
        private const val TAG = "NotificationsModule"
        private const val CHANNEL_ID = "sigx_lynxgo_default"
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

            val notification = NotificationCompat.Builder(mContext, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(body)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setAutoCancel(true)
                .build()

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

