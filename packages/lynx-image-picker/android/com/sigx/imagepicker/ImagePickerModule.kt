package com.sigx.imagepicker

import android.content.Context
import android.net.Uri
import android.util.Log
import android.webkit.MimeTypeMap
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap
import com.sigx.permissions.PermissionHelper
import java.io.File
import java.util.UUID

/**
 * Image picker module for selecting images/videos from gallery.
 * JS usage: NativeModules.ImagePicker.pickImage({ quality: 0.8 }, callback)
 */
class ImagePickerModule(context: Context) : LynxModule(context) {

    companion object {
        private const val TAG = "ImagePickerModule"
        const val REQUEST_PICK_IMAGE = 9002
    }

    @LynxMethod
    fun pickImage(options: ReadableMap?, callback: Callback?) {
        // Delegates to MediaCapture (in @sigx/lynx-permissions) — the
        // ActivityResultContracts.PickVisualMedia launcher registered at
        // MainActivity.onCreate. No CAMERA / READ_MEDIA permission needed —
        // Android 13+'s photo picker grants per-pick access on the fly.
        //
        // `selectionLimit` is computed JS-side from `multiple` / `maxItems`
        // and arrives here as an Int: 1 = single-pick, 0 = unlimited, N>1 =
        // capped multi-pick.
        val selectionLimit = if (options?.hasKey("selectionLimit") == true) {
            options.getInt("selectionLimit")
        } else 1
        if (selectionLimit == 1) {
            com.sigx.permissions.MediaCapture.pickImage { result ->
                callback?.invoke(persistAssets(result))
            }
        } else {
            // `0` means "no JS-side cap" — the launcher's hard cap takes over.
            com.sigx.permissions.MediaCapture.pickImages(selectionLimit) { result ->
                callback?.invoke(persistAssets(result))
            }
        }
    }

    @LynxMethod
    fun pickVideo(options: ReadableMap?, callback: Callback?) {
        // TODO: video picker via PickVisualMedia(VideoOnly). For now stubs
        // out the same shape so the JS layer doesn't crash.
        val result = JavaOnlyMap()
        result.putBoolean("cancelled", true)
        result.putArray("assets", JavaOnlyArray())
        callback?.invoke(result)
    }

    @LynxMethod
    fun requestPermission(callback: Callback?) {
        PermissionHelper.requestPermission(mContext, "photo_library") { result ->
            callback?.invoke(result)
        }
    }

    @LynxMethod
    fun getPermissionStatus(callback: Callback?) {
        val result = PermissionHelper.checkPermission(mContext, "photo_library")
        callback?.invoke(result)
    }

    /**
     * Persist picked images into the app's filesDir so the resulting URI
     * survives across app launches. Android's photo picker hands back a
     * `content://` URI with an ephemeral, Activity-scoped read grant — once
     * the app is killed the grant is gone and `<image src="content://...">`
     * silently fails on the next launch.
     *
     * Each picked asset's stream is copied to `filesDir/picked/<uuid>.<ext>`
     * preserving the source MIME's extension (jpg/png/webp/...) so that
     * downstream decoders that key on the extension keep working. The
     * emitted shape uses the JS-canonical `cancelled` spelling (two l's)
     * and always includes an `assets` array (possibly empty on cancel).
     */
    private fun persistAssets(result: JavaOnlyMap): JavaOnlyMap {
        // Accept both spellings from the launcher layer just in case; emit
        // only the JS-canonical `cancelled`.
        val cancelled = when {
            result.hasKey("cancelled") -> result.getBoolean("cancelled")
            result.hasKey("canceled") -> result.getBoolean("canceled")
            else -> false
        }

        val out = JavaOnlyMap()
        out.putBoolean("cancelled", cancelled)

        val newAssets = JavaOnlyArray()
        if (!cancelled) {
            val assets = result.getArray("assets")
            if (assets != null) {
                for (i in 0 until assets.size()) {
                    val asset = assets.getMap(i)
                    val uri = asset?.getString("uri")
                    val type = asset?.getString("type") ?: "image"
                    val persisted = uri?.let { persistOne(it) } ?: uri
                    val rebuilt = JavaOnlyMap().apply {
                        if (persisted != null) putString("uri", persisted)
                        putString("type", type)
                    }
                    newAssets.pushMap(rebuilt)
                }
            }
        }
        out.putArray("assets", newAssets)
        return out
    }

    private fun persistOne(uriStr: String): String? {
        // `file://` URIs are already persistent — pass through.
        if (uriStr.startsWith("file://") || uriStr.startsWith("/")) return uriStr
        return try {
            val src = Uri.parse(uriStr)
            // Preserve the source extension so consumers keying on file
            // suffix or MIME-by-extension keep working (PNG/WEBP can't be
            // safely renamed to .jpg — the bytes are unchanged).
            val mime = mContext.contentResolver.getType(src)
            val ext = mime?.let { MimeTypeMap.getSingleton().getExtensionFromMimeType(it) } ?: "jpg"
            val pickedDir = File(mContext.filesDir, "picked").apply { mkdirs() }
            val outFile = File(pickedDir, "pick_${UUID.randomUUID()}.$ext")
            mContext.contentResolver.openInputStream(src)?.use { input ->
                outFile.outputStream().use { output ->
                    input.copyTo(output)
                }
            } ?: return null
            Uri.fromFile(outFile).toString()
        } catch (e: Throwable) {
            Log.w(TAG, "persistOne failed for $uriStr: ${e.message}")
            null
        }
    }
}


