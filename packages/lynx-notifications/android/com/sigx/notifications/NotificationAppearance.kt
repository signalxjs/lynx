package com.sigx.notifications

import android.content.Context

/**
 * Resolves the app's notification appearance resources by NAME, not by R
 * reference: the resources are generated into the consuming app by
 * `sigx prebuild` (config `android.notificationIcon` / `notificationColor`),
 * so this module can't link against them at compile time. Name-based lookup
 * keeps the module decoupled — when the app hasn't configured them, we fall
 * back gracefully.
 */
internal object NotificationAppearance {

    /**
     * Small icon for the status bar. Prefers the prebuild-generated
     * `@drawable/ic_notification` (white-on-transparent, renders correctly as
     * a monochrome silhouette); falls back to the launcher icon
     * (`applicationInfo.icon` — better than a stock system shape, though
     * Android flattens it to a blob), then the stock dialog icon.
     */
    fun smallIcon(context: Context): Int {
        val generated = context.resources.getIdentifier(
            "ic_notification", "drawable", context.packageName,
        )
        if (generated != 0) return generated
        val launcher = context.applicationInfo.icon
        return if (launcher != 0) launcher else android.R.drawable.ic_dialog_info
    }

    /**
     * Accent color from the prebuild-generated `@color/notification_color`,
     * or null when the app hasn't configured one (system default applies).
     */
    fun accentColor(context: Context): Int? {
        val resId = context.resources.getIdentifier(
            "notification_color", "color", context.packageName,
        )
        if (resId == 0) return null
        return context.getColor(resId)
    }
}
