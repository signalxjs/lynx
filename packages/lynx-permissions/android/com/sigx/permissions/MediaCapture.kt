package com.sigx.permissions

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import com.lynx.react.bridge.JavaOnlyMap
import java.io.File
import java.lang.ref.WeakReference

/**
 * Module-level registry for Activity Result launchers. Camera + ImagePicker
 * (and any future module needing Activity-result flows) delegate here so a
 * single MainActivity hook covers them all.
 *
 * Design constraint: ActivityResultLaunchers MUST be registered BEFORE the
 * Activity reaches STARTED state. So `register(activity)` has to be called
 * from `onCreate()`, not lazily on first use. The MainActivity template
 * wires this via the same reflective `callPermissionHelper(...)` path used
 * for setActivity / clearActivity.
 *
 * Callbacks resolve once the user finishes the system UI (or cancels). We
 * stash the pending callback on the singleton because the Activity-result
 * launcher's own callback runs on the main thread but doesn't carry context;
 * the module-side caller registered its callback via `takePicture(callback)`
 * just before launching, and we route the result back to that callback.
 *
 * Concurrency: `pendingTakePictureCallback` and `pendingPickMediaCallback`
 * are guarded by their nullness — only one camera launch or one picker
 * launch at a time. Re-entrant calls overwrite the previous pending callback;
 * the pre-empted callback is invoked with `error="cancelled"`.
 */
object MediaCapture {

    private const val TAG = "MediaCapture"

    private var activityRef: WeakReference<ComponentActivity>? = null
    private var takePictureLauncher: ActivityResultLauncher<Uri>? = null
    private var pickMediaLauncher: ActivityResultLauncher<PickVisualMediaRequest>? = null

    private var pendingPhotoUri: Uri? = null
    private var pendingTakePictureCallback: ((JavaOnlyMap) -> Unit)? = null
    private var pendingPickMediaCallback: ((JavaOnlyMap) -> Unit)? = null

    /**
     * Wire this Activity into the registry. Call from MainActivity.onCreate
     * BEFORE super.onCreate() returns OR at the very top of onCreate (after
     * super) — registerForActivityResult requires the host to be in INITIALIZED
     * or CREATED state, throws afterwards.
     */
    fun register(activity: ComponentActivity) {
        activityRef = WeakReference(activity)

        takePictureLauncher = activity.registerForActivityResult(
            ActivityResultContracts.TakePicture()
        ) { success ->
            val uri = pendingPhotoUri
            val cb = pendingTakePictureCallback
            pendingPhotoUri = null
            pendingTakePictureCallback = null
            val result = JavaOnlyMap()
            if (success && uri != null) {
                result.putString("uri", uri.toString())
                result.putBoolean("canceled", false)
            } else {
                result.putString("error", "cancelled")
                result.putBoolean("canceled", true)
            }
            cb?.invoke(result)
        }

        pickMediaLauncher = activity.registerForActivityResult(
            ActivityResultContracts.PickVisualMedia()
        ) { uri ->
            val cb = pendingPickMediaCallback
            pendingPickMediaCallback = null
            val result = JavaOnlyMap()
            if (uri != null) {
                val assets = com.lynx.react.bridge.JavaOnlyArray()
                val asset = JavaOnlyMap().apply {
                    putString("uri", uri.toString())
                    putString("type", "image")
                }
                assets.pushMap(asset)
                result.putArray("assets", assets)
                result.putBoolean("canceled", false)
            } else {
                result.putBoolean("canceled", true)
            }
            cb?.invoke(result)
        }

        Log.i(TAG, "registered launchers on ${activity.javaClass.simpleName}")
    }

    /**
     * Clear the Activity reference. Call from MainActivity.onDestroy.
     */
    fun unregister() {
        activityRef = null
        takePictureLauncher = null
        pickMediaLauncher = null
        // Resolve any pending callbacks with cancel so JS Promises don't hang.
        pendingTakePictureCallback?.invoke(JavaOnlyMap().apply {
            putString("error", "activity destroyed")
            putBoolean("canceled", true)
        })
        pendingPickMediaCallback?.invoke(JavaOnlyMap().apply {
            putString("error", "activity destroyed")
            putBoolean("canceled", true)
        })
        pendingTakePictureCallback = null
        pendingPickMediaCallback = null
        pendingPhotoUri = null
    }

    /**
     * Launch the system camera. Requires CAMERA permission + a configured
     * FileProvider authority "${packageName}.fileprovider" (the MainActivity
     * AndroidManifest template seeds this). The captured photo lands at
     * cacheDir/sigx-camera-<timestamp>.jpg; the JS callback receives a
     * content:// URI pointing at it.
     */
    fun takePicture(context: Context, callback: (JavaOnlyMap) -> Unit) {
        val activity = activityRef?.get()
        val launcher = takePictureLauncher
        if (activity == null || launcher == null) {
            callback(JavaOnlyMap().apply {
                putString("error", "MediaCapture not registered — wire MediaCapture.register(this) into MainActivity.onCreate")
                putBoolean("canceled", true)
            })
            return
        }
        // Pre-empt any prior pending call.
        pendingTakePictureCallback?.invoke(JavaOnlyMap().apply {
            putString("error", "cancelled by new takePicture")
            putBoolean("canceled", true)
        })

        val photoFile = File(context.cacheDir, "sigx-camera-${System.currentTimeMillis()}.jpg")
        val authority = "${context.packageName}.fileprovider"
        val photoUri = try {
            FileProvider.getUriForFile(context, authority, photoFile)
        } catch (e: Throwable) {
            callback(JavaOnlyMap().apply {
                putString("error", "FileProvider authority '$authority' not configured: ${e.message}")
                putBoolean("canceled", true)
            })
            return
        }

        pendingPhotoUri = photoUri
        pendingTakePictureCallback = callback
        try {
            launcher.launch(photoUri)
        } catch (e: Throwable) {
            pendingPhotoUri = null
            pendingTakePictureCallback = null
            callback(JavaOnlyMap().apply {
                putString("error", e.message ?: "launcher.launch failed")
                putBoolean("canceled", true)
            })
        }
    }

    /**
     * Launch the system photo picker. No CAMERA / READ_MEDIA_IMAGES permission
     * needed — Android 13+'s photo picker grants per-pick access on the fly.
     * Returns a content:// URI for the picked image (or canceled=true).
     */
    fun pickImage(callback: (JavaOnlyMap) -> Unit) {
        val launcher = pickMediaLauncher
        if (launcher == null) {
            callback(JavaOnlyMap().apply {
                putString("error", "MediaCapture not registered — wire MediaCapture.register(this) into MainActivity.onCreate")
                putBoolean("canceled", true)
            })
            return
        }
        pendingPickMediaCallback?.invoke(JavaOnlyMap().apply {
            putString("error", "cancelled by new pickImage")
            putBoolean("canceled", true)
        })
        pendingPickMediaCallback = callback
        try {
            launcher.launch(
                PickVisualMediaRequest.Builder()
                    .setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly)
                    .build()
            )
        } catch (e: Throwable) {
            pendingPickMediaCallback = null
            callback(JavaOnlyMap().apply {
                putString("error", e.message ?: "launcher.launch failed")
                putBoolean("canceled", true)
            })
        }
    }
}
