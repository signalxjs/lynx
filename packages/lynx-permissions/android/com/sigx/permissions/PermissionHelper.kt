package com.sigx.permissions

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.lynx.react.bridge.JavaOnlyMap
import java.lang.ref.WeakReference

/**
 * Shared permission utility for sigx-lynx-go native modules.
 *
 * NOT a LynxModule — a Kotlin utility class that other modules (CameraModule,
 * LocationModule, etc.) call internally to check and request permissions.
 *
 * Requires [setActivity] to be called from MainActivity.onResume() so that
 * runtime permission requests can show the OS dialog.
 */
object PermissionHelper {

    private const val TAG = "PermissionHelper"

    private var activityRef: WeakReference<Activity>? = null
    private var requestCode = 1000
    private val pendingCallbacks = mutableMapOf<Int, (JavaOnlyMap) -> Unit>()

    /**
     * Set the current Activity reference. Call from MainActivity.onResume().
     */
    fun setActivity(activity: Activity) {
        activityRef = WeakReference(activity)
    }

    /**
     * Clear the Activity reference. Call from MainActivity.onPause().
     */
    fun clearActivity() {
        activityRef = null
    }

    /**
     * Map a sigx permission key to Android permission string(s).
     * Handles API-level branching (e.g., READ_MEDIA_IMAGES on API 33+).
     */
    fun resolveAndroidPermissions(permission: String): List<String> {
        return when (permission) {
            "camera" -> listOf(Manifest.permission.CAMERA)
            "microphone" -> listOf(Manifest.permission.RECORD_AUDIO)
            "location_when_in_use", "location" -> listOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            )
            "location_always" -> listOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            "photo_library" -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    listOf(
                        Manifest.permission.READ_MEDIA_IMAGES,
                        Manifest.permission.READ_MEDIA_VIDEO
                    )
                } else {
                    @Suppress("DEPRECATION")
                    listOf(Manifest.permission.READ_EXTERNAL_STORAGE)
                }
            }
            "notifications" -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    listOf(Manifest.permission.POST_NOTIFICATIONS)
                } else {
                    emptyList() // No runtime permission needed pre-API 33
                }
            }
            "contacts" -> listOf(Manifest.permission.READ_CONTACTS)
            "calendar" -> listOf(Manifest.permission.READ_CALENDAR)
            "bluetooth" -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    listOf(
                        Manifest.permission.BLUETOOTH_SCAN,
                        Manifest.permission.BLUETOOTH_CONNECT
                    )
                } else {
                    @Suppress("DEPRECATION")
                    listOf(Manifest.permission.BLUETOOTH)
                }
            }
            else -> {
                // Allow raw Android permission strings (e.g., "android.permission.CAMERA")
                if (permission.startsWith("android.permission.")) {
                    listOf(permission)
                } else {
                    Log.w(TAG, "Unknown permission key: $permission")
                    emptyList()
                }
            }
        }
    }

    /**
     * Check permission status without prompting.
     * Returns a map with { status, canAskAgain }.
     */
    fun checkPermission(context: Context, permission: String): JavaOnlyMap {
        val androidPerms = resolveAndroidPermissions(permission)
        val result = JavaOnlyMap()

        if (androidPerms.isEmpty()) {
            // No runtime permission required (e.g., notifications pre-API 33)
            result.putString("status", "granted")
            result.putBoolean("canAskAgain", false)
            return result
        }

        val allGranted = androidPerms.all { perm ->
            ContextCompat.checkSelfPermission(context, perm) == PackageManager.PERMISSION_GRANTED
        }

        if (allGranted) {
            result.putString("status", "granted")
            result.putBoolean("canAskAgain", false)
            return result
        }

        // Check if we can ask again (only meaningful if we have an Activity)
        val activity = activityRef?.get()
        val canAskAgain = if (activity != null) {
            androidPerms.any { perm ->
                ActivityCompat.shouldShowRequestPermissionRationale(activity, perm)
            }
        } else {
            true // Assume we can ask if no Activity to check
        }

        // Determine if blocked (denied + can't ask again) vs undetermined (never asked)
        val anyDeniedPermanently = activity != null && androidPerms.any { perm ->
            ContextCompat.checkSelfPermission(context, perm) != PackageManager.PERMISSION_GRANTED &&
                !ActivityCompat.shouldShowRequestPermissionRationale(activity, perm)
        }

        // If permission was never requested, shouldShowRationale returns false too,
        // so we use SharedPreferences to track if we've asked before
        val prefs = context.getSharedPreferences("sigx_permissions", Context.MODE_PRIVATE)
        val hasAskedBefore = prefs.getBoolean("asked_$permission", false)

        if (!hasAskedBefore) {
            result.putString("status", "undetermined")
            result.putBoolean("canAskAgain", true)
        } else if (anyDeniedPermanently && !canAskAgain) {
            result.putString("status", "blocked")
            result.putBoolean("canAskAgain", false)
        } else {
            result.putString("status", "denied")
            result.putBoolean("canAskAgain", canAskAgain)
        }

        return result
    }

    /**
     * Request a permission, showing the OS dialog if possible.
     * Calls back with { status, canAskAgain }.
     */
    fun requestPermission(context: Context, permission: String, callback: (JavaOnlyMap) -> Unit) {
        val androidPerms = resolveAndroidPermissions(permission)

        if (androidPerms.isEmpty()) {
            val result = JavaOnlyMap()
            result.putString("status", "granted")
            result.putBoolean("canAskAgain", false)
            callback(result)
            return
        }

        // Check if already granted
        val allGranted = androidPerms.all { perm ->
            ContextCompat.checkSelfPermission(context, perm) == PackageManager.PERMISSION_GRANTED
        }
        if (allGranted) {
            val result = JavaOnlyMap()
            result.putString("status", "granted")
            result.putBoolean("canAskAgain", false)
            callback(result)
            return
        }

        val activity = activityRef?.get()
        if (activity == null) {
            Log.w(TAG, "No Activity available to request permission: $permission")
            val result = JavaOnlyMap()
            result.putString("status", "denied")
            result.putBoolean("canAskAgain", true)
            callback(result)
            return
        }

        // Mark that we've asked for this permission
        val prefs = context.getSharedPreferences("sigx_permissions", Context.MODE_PRIVATE)
        prefs.edit().putBoolean("asked_$permission", true).apply()

        // Request the permission
        val code = requestCode++
        pendingCallbacks[code] = callback
        ActivityCompat.requestPermissions(activity, androidPerms.toTypedArray(), code)
    }

    /**
     * Called from MainActivity.onRequestPermissionsResult() to resolve pending callbacks.
     */
    fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        val callback = pendingCallbacks.remove(requestCode) ?: return

        val allGranted = grantResults.isNotEmpty() && grantResults.all {
            it == PackageManager.PERMISSION_GRANTED
        }

        val result = JavaOnlyMap()
        if (allGranted) {
            result.putString("status", "granted")
            result.putBoolean("canAskAgain", false)
        } else {
            val activity = activityRef?.get()
            val canAskAgain = activity != null && permissions.any { perm ->
                ActivityCompat.shouldShowRequestPermissionRationale(activity, perm)
            }
            result.putString("status", if (canAskAgain) "denied" else "blocked")
            result.putBoolean("canAskAgain", canAskAgain)
        }

        callback(result)
    }

    /**
     * Open the app's system settings page (for when permissions are blocked).
     */
    fun openSettings(context: Context) {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.fromParts("package", context.packageName, null)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }
}
