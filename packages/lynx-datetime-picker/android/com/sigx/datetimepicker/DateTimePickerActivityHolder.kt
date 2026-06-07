package com.sigx.datetimepicker

import android.app.Activity
import java.lang.ref.WeakReference

/**
 * Holds a [WeakReference] to the current foreground [Activity] so
 * `DatePickerDialog` / `TimePickerDialog` can attach a window without
 * leaking the host. Populated by [DateTimePickerActivityHook] from the
 * auto-linked Activity lifecycle.
 */
internal object DateTimePickerActivityHolder {

    private var ref: WeakReference<Activity>? = null

    fun setActivity(activity: Activity) {
        ref = WeakReference(activity)
    }

    /** Clear only if [activity] is the one currently held — avoids racing
     *  a stale `onPause` against a new `onResume`. */
    fun clearIf(activity: Any) {
        val current = ref?.get() ?: return
        if (current === activity) {
            ref = null
        }
    }

    fun current(): Activity? = ref?.get()
}
