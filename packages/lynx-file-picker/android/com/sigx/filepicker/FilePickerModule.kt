package com.sigx.filepicker

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap
import java.io.File
import java.util.UUID

/**
 * Generic file picker module — pick any file via the Storage Access
 * Framework (`OpenDocument` / `OpenMultipleDocuments`).
 * JS usage: NativeModules.FilePicker.pick({ multiple: true, types: ["application/pdf"] }, callback)
 *
 * Delegates launching to MediaCapture (in @sigx/lynx-permissions) — the
 * ActivityResult launchers registered at MainActivity.onCreate. No runtime
 * permission needed; SAF grants per-pick read access on the fly.
 */
class FilePickerModule(context: Context) : LynxModule(context) {

    companion object {
        private const val TAG = "FilePickerModule"
    }

    @LynxMethod
    fun pick(options: ReadableMap?, callback: Callback?) {
        val multiple = options?.hasKey("multiple") == true && options.getBoolean("multiple")
        val copyToCache = !(options?.hasKey("copyToCache") == true && !options.getBoolean("copyToCache"))
        val types = mutableListOf<String>()
        if (options?.hasKey("types") == true) {
            val arr = options.getArray("types")
            if (arr != null) {
                for (i in 0 until arr.size()) {
                    arr.getString(i)?.let { if (it.isNotEmpty()) types.add(it) }
                }
            }
        }

        val handler: (JavaOnlyMap) -> Unit = { result ->
            callback?.invoke(resolveAssets(result, copyToCache))
        }
        if (multiple) {
            com.sigx.permissions.MediaCapture.pickFiles(types.toTypedArray(), handler)
        } else {
            com.sigx.permissions.MediaCapture.pickFile(types.toTypedArray(), handler)
        }
    }

    /**
     * Rebuild the launcher result with resolved metadata and (optionally)
     * persisted URIs. SAF hands back `content://` URIs whose read grant is
     * ephemeral and Activity-scoped — copying into `filesDir/picked` (the
     * image-picker convention) yields a stable `file://` URI that survives
     * app restarts. Emits the JS-canonical `cancelled` spelling and always
     * includes an `assets` array.
     */
    private fun resolveAssets(result: JavaOnlyMap, copyToCache: Boolean): JavaOnlyMap {
        val cancelled = when {
            result.hasKey("cancelled") -> result.getBoolean("cancelled")
            result.hasKey("canceled") -> result.getBoolean("canceled")
            else -> false
        }

        val out = JavaOnlyMap()
        out.putBoolean("cancelled", cancelled)
        if (result.hasKey("error")) {
            result.getString("error")?.let { out.putString("error", it) }
        }

        val newAssets = JavaOnlyArray()
        if (!cancelled) {
            val assets = result.getArray("assets")
            if (assets != null) {
                for (i in 0 until assets.size()) {
                    val uriStr = assets.getMap(i)?.getString("uri") ?: continue
                    resolveOne(uriStr, copyToCache)?.let { newAssets.pushMap(it) }
                }
            }
        }
        out.putArray("assets", newAssets)
        return out
    }

    private fun resolveOne(uriStr: String, copyToCache: Boolean): JavaOnlyMap? {
        return try {
            val src = Uri.parse(uriStr)
            var name: String? = null
            var size = 0L

            if (src.scheme == "content") {
                mContext.contentResolver.query(
                    src,
                    arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
                    null, null, null,
                )?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (nameIdx >= 0 && !cursor.isNull(nameIdx)) name = cursor.getString(nameIdx)
                        val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
                        if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) size = cursor.getLong(sizeIdx)
                    }
                }
            } else {
                val f = File(src.path ?: uriStr)
                name = f.name
                size = f.length()
            }

            val mime = (if (src.scheme == "content") mContext.contentResolver.getType(src) else null)
                ?: "application/octet-stream"
            val resolvedName = name ?: src.lastPathSegment ?: "file"

            var uri = uriStr
            if (copyToCache && src.scheme == "content") {
                val persisted = persistOne(src, resolvedName)
                if (persisted != null) {
                    uri = persisted
                    if (size <= 0L) {
                        size = File(Uri.parse(persisted).path ?: "").length()
                    }
                }
            }

            JavaOnlyMap().apply {
                putString("uri", uri)
                putString("name", resolvedName)
                putString("mimeType", mime)
                putDouble("size", size.toDouble())
            }
        } catch (e: Throwable) {
            Log.w(TAG, "resolveOne failed for $uriStr: ${e.message}")
            null
        }
    }

    /**
     * Copy a `content://` stream into `filesDir/picked/pick_<uuid>_<name>`.
     * The original (sanitized) file name is kept as the suffix so extension-
     * keyed consumers keep working; the `name` field still carries the
     * unmodified display name.
     */
    private fun persistOne(src: Uri, displayName: String): String? {
        return try {
            val safeName = displayName.replace(Regex("[^A-Za-z0-9._-]"), "_")
            val pickedDir = File(mContext.filesDir, "picked").apply { mkdirs() }
            val outFile = File(pickedDir, "pick_${UUID.randomUUID()}_$safeName")
            mContext.contentResolver.openInputStream(src)?.use { input ->
                outFile.outputStream().use { output ->
                    input.copyTo(output)
                }
            } ?: return null
            Uri.fromFile(outFile).toString()
        } catch (e: Throwable) {
            Log.w(TAG, "persistOne failed for $src: ${e.message}")
            null
        }
    }
}
