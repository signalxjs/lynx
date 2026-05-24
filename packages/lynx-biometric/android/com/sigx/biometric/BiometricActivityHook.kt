package com.sigx.biometric

import android.app.Activity
import android.os.Bundle
import androidx.fragment.app.FragmentActivity

/**
 * Activity-lifecycle hook for `@sigx/lynx-biometric`.
 *
 * Discovered by the auto-linker via `signalx-module.json`'s
 * `android.activityHook`. `androidx.biometric.BiometricPrompt` requires a
 * `FragmentActivity` host, so we capture a weak reference to it here and
 * the module dereferences when it needs to show the prompt.
 *
 * Not shared with `@sigx/lynx-permissions` because that package's
 * [com.sigx.permissions.PermissionHelper] stores an [Activity], not a
 * [FragmentActivity], and we don't want to introduce a peer dep just to
 * share one reference.
 */
object BiometricActivityHook {

    @JvmStatic
    fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
        if (activity is FragmentActivity) {
            BiometricActivityHolder.setActivity(activity)
        }
    }

    @JvmStatic
    fun onResume(activity: Activity) {
        if (activity is FragmentActivity) {
            BiometricActivityHolder.setActivity(activity)
        }
    }

    @JvmStatic
    fun onPause(activity: Activity) {
        BiometricActivityHolder.clearIf(activity)
    }
}
