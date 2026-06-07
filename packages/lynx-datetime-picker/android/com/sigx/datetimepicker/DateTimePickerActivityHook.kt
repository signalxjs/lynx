package com.sigx.datetimepicker

import android.app.Activity
import android.os.Bundle

/**
 * Activity-lifecycle hook for `@sigx/lynx-datetime-picker`.
 *
 * Discovered by the auto-linker via `signalx-module.json`'s
 * `android.activityHook`. Dialogs need an Activity window to attach to —
 * the module's application context can't host one — so we capture a weak
 * reference to the foreground Activity here. Unlike the biometric hook,
 * a plain [Activity] suffices ([android.app.DatePickerDialog] is not a
 * fragment-based API).
 */
object DateTimePickerActivityHook {

    @JvmStatic
    fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
        DateTimePickerActivityHolder.setActivity(activity)
    }

    @JvmStatic
    fun onResume(activity: Activity) {
        DateTimePickerActivityHolder.setActivity(activity)
    }

    @JvmStatic
    fun onPause(activity: Activity) {
        DateTimePickerActivityHolder.clearIf(activity)
    }
}
