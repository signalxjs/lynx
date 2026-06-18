package com.sigx.webauth

import android.app.Activity

/**
 * Activity-lifecycle hook for `@sigx/lynx-webauth`.
 *
 * Discovered by the auto-linker via `signalx-module.json`'s
 * `android.activityHook`; the generated `GeneratedActivityHooks` calls
 * [onResume] from `MainActivity.onResume`. That's the signal we use to detect a
 * Custom Tabs session the user dismissed without completing — see
 * [WebAuthSession.onHostResume].
 */
object WebAuthActivityHook {

    @JvmStatic
    fun onResume(activity: Activity) {
        WebAuthSession.onHostResume()
    }
}
