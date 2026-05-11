package com.sigx.permissions

import android.app.Activity
import android.os.Bundle
import androidx.activity.ComponentActivity

/**
 * Activity-lifecycle hook for `@sigx/lynx-permissions`.
 *
 * Discovered by the auto-linker via `sigx-module.json`'s
 * `android.activityHook`. Wires the host Activity into [PermissionHelper]
 * (so runtime permission prompts can show their OS dialog) and registers
 * Activity-result launchers used by Camera + ImagePicker.
 *
 * `MediaCapture.register` MUST run before the Activity reaches STARTED — the
 * Android Activity-result API enforces this — so we call it from `onCreate`
 * rather than `onResume`.
 */
object PermissionsActivityHook {

    @JvmStatic
    fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
        if (activity is ComponentActivity) {
            MediaCapture.register(activity)
        }
    }

    @JvmStatic
    fun onResume(activity: Activity) {
        PermissionHelper.setActivity(activity)
    }

    @JvmStatic
    fun onPause(activity: Activity) {
        PermissionHelper.clearActivity()
    }

    @JvmStatic
    fun onRequestPermissionsResult(
        activity: Activity,
        requestCode: Int,
        permissions: Array<String>,
        grantResults: IntArray,
    ) {
        PermissionHelper.onRequestPermissionsResult(requestCode, permissions, grantResults)
    }
}
