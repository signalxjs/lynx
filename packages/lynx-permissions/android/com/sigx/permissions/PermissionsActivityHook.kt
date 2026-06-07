package com.sigx.permissions

import android.app.Activity
import android.os.Bundle
import androidx.activity.ComponentActivity

/**
 * Activity-lifecycle hook for `@sigx/lynx-permissions`.
 *
 * Discovered by the auto-linker via `signalx-module.json`'s
 * `android.activityHook`. Registers Activity-result launchers used by
 * Camera + ImagePicker and routes permission results into [PermissionHelper].
 * (The foreground-Activity reference itself lives in `@sigx/lynx-core`'s
 * shared `SigxActivityHolder` — no per-package holder here.)
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
    fun onRequestPermissionsResult(
        activity: Activity,
        requestCode: Int,
        permissions: Array<String>,
        grantResults: IntArray,
    ) {
        PermissionHelper.onRequestPermissionsResult(requestCode, permissions, grantResults)
    }
}
