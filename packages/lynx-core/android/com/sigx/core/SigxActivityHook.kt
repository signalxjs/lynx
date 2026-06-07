package com.sigx.core

import android.app.Activity
import android.os.Bundle

/**
 * Activity-lifecycle hook for `@sigx/lynx-core`.
 *
 * Discovered by the auto-linker via `signalx-module.json`'s
 * `android.activityHook` and called first in `GeneratedActivityHooks` (the
 * linker orders `@sigx/lynx-core` ahead of other modules), so
 * [SigxActivityHolder] is populated before any other hook runs in the same
 * lifecycle callback.
 */
object SigxActivityHook {

    @JvmStatic
    fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
        SigxActivityHolder.setActivity(activity)
    }

    @JvmStatic
    fun onResume(activity: Activity) {
        SigxActivityHolder.setActivity(activity)
    }

    @JvmStatic
    fun onPause(activity: Activity) {
        SigxActivityHolder.clearIf(activity)
    }
}
