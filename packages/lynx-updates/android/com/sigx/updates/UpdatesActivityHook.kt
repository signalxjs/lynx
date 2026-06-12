package com.sigx.updates

import android.app.Activity

/**
 * Activity hook (declared in signalx-module.json) that turns resume-after-
 * pause into a `foreground` event for JS `checkOn: ['foreground']` re-checks.
 * The first onResume of a launch is swallowed — cold start is covered by
 * the `launch` trigger and would otherwise double-check.
 */
object UpdatesActivityHook {

    private var sawPause = false

    fun onResume(activity: Activity) {
        if (sawPause) {
            sawPause = false
            UpdatesEventBus.emitForeground()
        }
    }

    fun onPause(activity: Activity) {
        sawPause = true
    }
}
