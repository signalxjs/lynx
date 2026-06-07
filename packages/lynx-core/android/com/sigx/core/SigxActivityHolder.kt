package com.sigx.core

import android.app.Activity
import androidx.fragment.app.FragmentActivity
import java.lang.ref.WeakReference

/**
 * Shared holder for the current foreground [Activity], so modules that
 * present platform UI (dialogs, prompts, pickers) can attach without leaking
 * the host. Populated by [SigxActivityHook] from the auto-linked Activity
 * lifecycle; consumed lazily by modules at call time.
 */
object SigxActivityHolder {

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

    /** The held Activity as a [FragmentActivity], or null if it isn't one
     *  (e.g. `androidx.biometric.BiometricPrompt` requires that host). */
    fun currentFragmentActivity(): FragmentActivity? = ref?.get() as? FragmentActivity
}
