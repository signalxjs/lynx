package com.sigx.securestorage

import android.app.Activity
import android.os.Bundle
import androidx.fragment.app.FragmentActivity

/**
 * Activity-lifecycle hook for `@sigx/lynx-secure-storage`.
 *
 * Discovered by the auto-linker via `signalx-module.json`'s
 * `android.activityHook`. We need a [FragmentActivity] to drive
 * `BiometricPrompt` when reading a key stored with
 * `setUserAuthenticationRequired(true)`.
 */
object SecureStorageActivityHook {

    @JvmStatic
    fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
        if (activity is FragmentActivity) {
            SecureStorageActivityHolder.setActivity(activity)
        }
    }

    @JvmStatic
    fun onResume(activity: Activity) {
        if (activity is FragmentActivity) {
            SecureStorageActivityHolder.setActivity(activity)
        }
    }

    @JvmStatic
    fun onPause(activity: Activity) {
        SecureStorageActivityHolder.clearIf(activity)
    }
}
