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
    /**
     * Upper bound for the registered `PickMultipleVisualMedia` launcher.
     * Caller-supplied `maxItems` is enforced client-side by trimming the
     * returned URIs — re-registering the launcher per call isn't allowed
     * after onCreate so we use a single high-water-mark launcher and trim.
     */
    private const val MULTI_PICK_HARD_CAP = 50

    private var activityRef: WeakReference<ComponentActivity>? = null
    private var takePictureLauncher: ActivityResultLauncher<Uri>? = null
    private var pickMediaLauncher: ActivityResultLauncher<PickVisualMediaRequest>? = null
    private var pickMultipleMediaLauncher: ActivityResultLauncher<PickVisualMediaRequest>? = null
    private var openDocumentLauncher: ActivityResultLauncher<Array<String>>? = null
    private var openMultipleDocumentsLauncher: ActivityResultLauncher<Array<String>>? = null

    private var pendingPhotoUri: Uri? = null
    private var pendingTakePictureCallback: ((JavaOnlyMap) -> Unit)? = null
    private var pendingPickMediaCallback: ((JavaOnlyMap) -> Unit)? = null
    private var pendingPickMultipleMediaCallback: ((JavaOnlyMap) -> Unit)? = null
    private var pendingOpenDocumentCallback: ((JavaOnlyMap) -> Unit)? = null
    private var pendingOpenMultipleDocumentsCallback: ((JavaOnlyMap) -> Unit)? = null
    /**
     * Caller-requested cap for multi-pick. The Android `PickMultipleVisualMedia`
     * launcher is registered with a fixed upper bound; we trim the returned
     * URIs to this value so JS-side `maxItems` is honored even when it's
     * smaller than the registered cap.
     */
    private var pendingPickMultipleMax: Int = MULTI_PICK_HARD_CAP


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
                result.putBoolean("cancelled", false)
            } else {
                result.putString("error", "cancelled")
                result.putBoolean("cancelled", true)
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
                result.putBoolean("cancelled", false)
            } else {
                result.putBoolean("cancelled", true)
                result.putArray("assets", com.lynx.react.bridge.JavaOnlyArray())
            }
            cb?.invoke(result)
        }

        // Multi-pick launcher. Registered with the hard cap; the per-call
        // `maxItems` is honored by trimming the returned URI list below.
        pickMultipleMediaLauncher = activity.registerForActivityResult(
            ActivityResultContracts.PickMultipleVisualMedia(MULTI_PICK_HARD_CAP)
        ) { uris ->
            val cb = pendingPickMultipleMediaCallback
            val cap = pendingPickMultipleMax
            pendingPickMultipleMediaCallback = null
            pendingPickMultipleMax = MULTI_PICK_HARD_CAP
            val result = JavaOnlyMap()
            if (uris.isNullOrEmpty()) {
                result.putBoolean("cancelled", true)
                result.putArray("assets", com.lynx.react.bridge.JavaOnlyArray())
            } else {
                val assets = com.lynx.react.bridge.JavaOnlyArray()
                val trimmed = if (cap > 0 && uris.size > cap) uris.subList(0, cap) else uris
                for (uri in trimmed) {
                    val asset = JavaOnlyMap().apply {
                        putString("uri", uri.toString())
                        putString("type", "image")
                    }
                    assets.pushMap(asset)
                }
                result.putArray("assets", assets)
                result.putBoolean("cancelled", false)
            }
            cb?.invoke(result)
        }

        // SAF document pickers (any file type, not just visual media). The
        // MIME-type filter is a per-launch input (unlike PickMultipleVisualMedia's
        // cap), so a single launcher pair covers every FilePicker call.
        openDocumentLauncher = activity.registerForActivityResult(
            ActivityResultContracts.OpenDocument()
        ) { uri ->
            val cb = pendingOpenDocumentCallback
            pendingOpenDocumentCallback = null
            cb?.invoke(documentResult(if (uri != null) listOf(uri) else emptyList()))
        }

        openMultipleDocumentsLauncher = activity.registerForActivityResult(
            ActivityResultContracts.OpenMultipleDocuments()
        ) { uris ->
            val cb = pendingOpenMultipleDocumentsCallback
            pendingOpenMultipleDocumentsCallback = null
            cb?.invoke(documentResult(uris))
        }

        Log.i(TAG, "registered launchers on ${activity.javaClass.simpleName}")
    }

    /**
     * Build the `{ cancelled, assets: [{ uri }] }` shape for SAF document
     * picks. Metadata (name/size/MIME) and persistence are resolved by the
     * FilePicker module — this layer only routes URIs, matching how the
     * visual-media launchers leave `persistAssets` to ImagePickerModule.
     */
    private fun documentResult(uris: List<Uri>): JavaOnlyMap {
        val result = JavaOnlyMap()
        if (uris.isEmpty()) {
            result.putBoolean("cancelled", true)
            result.putArray("assets", com.lynx.react.bridge.JavaOnlyArray())
        } else {
            val assets = com.lynx.react.bridge.JavaOnlyArray()
            for (uri in uris) {
                assets.pushMap(JavaOnlyMap().apply { putString("uri", uri.toString()) })
            }
            result.putArray("assets", assets)
            result.putBoolean("cancelled", false)
        }
        return result
    }

    /**
     * Clear the Activity reference. Call from MainActivity.onDestroy.
     */
    fun unregister() {
        activityRef = null
        takePictureLauncher = null
        pickMediaLauncher = null
        pickMultipleMediaLauncher = null
        openDocumentLauncher = null
        openMultipleDocumentsLauncher = null
        // Resolve any pending callbacks with cancel so JS Promises don't hang.
        pendingTakePictureCallback?.invoke(JavaOnlyMap().apply {
            putString("error", "activity destroyed")
            putBoolean("cancelled", true)
        })
        pendingPickMediaCallback?.invoke(JavaOnlyMap().apply {
            putString("error", "activity destroyed")
            putBoolean("cancelled", true)
        })
        pendingPickMultipleMediaCallback?.invoke(JavaOnlyMap().apply {
            putString("error", "activity destroyed")
            putBoolean("cancelled", true)
        })
        pendingOpenDocumentCallback?.invoke(cancelledDocumentResult("activity destroyed"))
        pendingOpenMultipleDocumentsCallback?.invoke(cancelledDocumentResult("activity destroyed"))
        pendingTakePictureCallback = null
        pendingPickMediaCallback = null
        pendingPickMultipleMediaCallback = null
        pendingOpenDocumentCallback = null
        pendingOpenMultipleDocumentsCallback = null
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
                putBoolean("cancelled", true)
            })
            return
        }
        // Pre-empt any prior pending call.
        pendingTakePictureCallback?.invoke(JavaOnlyMap().apply {
            putString("error", "cancelled by new takePicture")
            putBoolean("cancelled", true)
        })

        val photoFile = File(context.cacheDir, "sigx-camera-${System.currentTimeMillis()}.jpg")
        val authority = "${context.packageName}.fileprovider"
        val photoUri = try {
            FileProvider.getUriForFile(context, authority, photoFile)
        } catch (e: Throwable) {
            callback(JavaOnlyMap().apply {
                putString("error", "FileProvider authority '$authority' not configured: ${e.message}")
                putBoolean("cancelled", true)
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
                putBoolean("cancelled", true)
            })
        }
    }

    /**
     * Launch the system photo picker. No CAMERA / READ_MEDIA_IMAGES permission
     * needed — Android 13+'s photo picker grants per-pick access on the fly.
     * Returns a content:// URI for the picked image (or cancelled=true).
     */
    fun pickImage(callback: (JavaOnlyMap) -> Unit) {
        val launcher = pickMediaLauncher
        if (launcher == null) {
            callback(JavaOnlyMap().apply {
                putString("error", "MediaCapture not registered — wire MediaCapture.register(this) into MainActivity.onCreate")
                putBoolean("cancelled", true)
            })
            return
        }
        pendingPickMediaCallback?.invoke(JavaOnlyMap().apply {
            putString("error", "cancelled by new pickImage")
            putBoolean("cancelled", true)
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
                putBoolean("cancelled", true)
            })
        }
    }

    /**
     * Multi-image variant of `pickImage`. `maxItems = 0` (or unset) yields the
     * registered hard cap (`MULTI_PICK_HARD_CAP`). Callers that pass smaller
     * values get the list trimmed client-side after the picker returns.
     *
     * The returned result shape matches single-pick:
     *   { cancelled: Boolean, assets: [{ uri, type: "image" }, ...] }
     */
    fun pickImages(maxItems: Int, callback: (JavaOnlyMap) -> Unit) {
        val launcher = pickMultipleMediaLauncher
        if (launcher == null) {
            callback(JavaOnlyMap().apply {
                putString("error", "MediaCapture not registered — wire MediaCapture.register(this) into MainActivity.onCreate")
                putBoolean("cancelled", true)
            })
            return
        }
        pendingPickMultipleMediaCallback?.invoke(JavaOnlyMap().apply {
            putString("error", "cancelled by new pickImages")
            putBoolean("cancelled", true)
        })
        pendingPickMultipleMediaCallback = callback
        pendingPickMultipleMax = if (maxItems > 0) maxItems else MULTI_PICK_HARD_CAP
        try {
            launcher.launch(
                PickVisualMediaRequest.Builder()
                    .setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly)
                    .build()
            )
        } catch (e: Throwable) {
            pendingPickMultipleMediaCallback = null
            callback(JavaOnlyMap().apply {
                putString("error", e.message ?: "launcher.launch failed")
                putBoolean("cancelled", true)
            })
        }
    }

    /**
     * `{ cancelled: true, assets: [], error }` — the document-pick error
     * shape. Always carries an `assets` array so the `{ cancelled, assets }`
     * contract holds on every code path.
     */
    private fun cancelledDocumentResult(error: String): JavaOnlyMap =
        JavaOnlyMap().apply {
            putString("error", error)
            putBoolean("cancelled", true)
            putArray("assets", com.lynx.react.bridge.JavaOnlyArray())
        }

    /**
     * Launch the SAF document picker for a single file of any type. No
     * runtime permission needed — SAF grants per-pick read access. `types`
     * is the MIME-type filter; empty means any file. Returns
     * `{ cancelled, assets: [{ uri }] }` with a `content://` URI.
     */
    fun pickFile(types: Array<String>, callback: (JavaOnlyMap) -> Unit) {
        val launcher = openDocumentLauncher
        if (launcher == null) {
            callback(cancelledDocumentResult("MediaCapture not registered — wire MediaCapture.register(this) into MainActivity.onCreate"))
            return
        }
        pendingOpenDocumentCallback?.invoke(cancelledDocumentResult("cancelled by new pickFile"))
        pendingOpenDocumentCallback = callback
        try {
            launcher.launch(if (types.isEmpty()) arrayOf("*/*") else types)
        } catch (e: Throwable) {
            pendingOpenDocumentCallback = null
            callback(cancelledDocumentResult(e.message ?: "launcher.launch failed"))
        }
    }

    /**
     * Multi-file variant of `pickFile`. SAF's OpenMultipleDocuments has no
     * selection cap concept, so unlike `pickImages` there's no trim step.
     */
    fun pickFiles(types: Array<String>, callback: (JavaOnlyMap) -> Unit) {
        val launcher = openMultipleDocumentsLauncher
        if (launcher == null) {
            callback(cancelledDocumentResult("MediaCapture not registered — wire MediaCapture.register(this) into MainActivity.onCreate"))
            return
        }
        pendingOpenMultipleDocumentsCallback?.invoke(cancelledDocumentResult("cancelled by new pickFiles"))
        pendingOpenMultipleDocumentsCallback = callback
        try {
            launcher.launch(if (types.isEmpty()) arrayOf("*/*") else types)
        } catch (e: Throwable) {
            pendingOpenMultipleDocumentsCallback = null
            callback(cancelledDocumentResult(e.message ?: "launcher.launch failed"))
        }
    }
}
