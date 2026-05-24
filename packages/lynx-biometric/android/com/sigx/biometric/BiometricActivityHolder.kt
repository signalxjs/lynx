package com.sigx.biometric

import androidx.fragment.app.FragmentActivity
import java.lang.ref.WeakReference

/**
 * Holds a [WeakReference] to the current foreground [FragmentActivity] so
 * `BiometricPrompt` can attach without leaking the host. Populated by
 * [BiometricActivityHook] from the auto-linked Activity lifecycle.
 */
internal object BiometricActivityHolder {

    private var ref: WeakReference<FragmentActivity>? = null

    fun setActivity(activity: FragmentActivity) {
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

    fun current(): FragmentActivity? = ref?.get()
}
