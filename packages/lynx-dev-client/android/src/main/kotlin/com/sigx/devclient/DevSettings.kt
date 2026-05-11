package com.sigx.devclient

import android.content.Context
import android.content.SharedPreferences

/**
 * Persists dev mode preferences across app restarts.
 */
class DevSettings(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    var perfHudEnabled: Boolean
        get() = prefs.getBoolean(KEY_PERF_HUD, false)
        set(value) = prefs.edit().putBoolean(KEY_PERF_HUD, value).apply()

    var logBoxEnabled: Boolean
        get() = prefs.getBoolean(KEY_LOGBOX, true)
        set(value) = prefs.edit().putBoolean(KEY_LOGBOX, value).apply()

    var lastConnectedUrl: String
        get() = prefs.getString(KEY_LAST_URL, "") ?: ""
        set(value) = prefs.edit().putString(KEY_LAST_URL, value).apply()

    /** History of dev-server URLs the user has connected to from `DevHomeScreen`, most-recent first. */
    val recentUrls: List<String>
        get() {
            val raw = prefs.getString(KEY_RECENT_URLS, null) ?: return emptyList()
            return raw.split('\n').filter { it.isNotBlank() }
        }

    /** Insert `url` at the front, dedup, trim to the cap, and update lastConnectedUrl. */
    fun addRecentUrl(url: String) {
        val trimmed = url.trim()
        if (trimmed.isBlank()) return
        val updated = (listOf(trimmed) + recentUrls.filter { it != trimmed }).take(RECENT_URLS_MAX)
        prefs.edit()
            .putString(KEY_RECENT_URLS, updated.joinToString("\n"))
            .putString(KEY_LAST_URL, trimmed)
            .apply()
    }

    fun removeRecentUrl(url: String) {
        val updated = recentUrls.filter { it != url }
        prefs.edit().putString(KEY_RECENT_URLS, updated.joinToString("\n")).apply()
    }

    fun clearRecentUrls() {
        prefs.edit().remove(KEY_RECENT_URLS).apply()
    }

    companion object {
        private const val PREFS_NAME = "sigx_dev_client"
        private const val KEY_PERF_HUD = "perf_hud_enabled"
        private const val KEY_LOGBOX = "logbox_enabled"
        private const val KEY_LAST_URL = "last_connected_url"
        private const val KEY_RECENT_URLS = "recent_urls"
        private const val RECENT_URLS_MAX = 20
    }
}
