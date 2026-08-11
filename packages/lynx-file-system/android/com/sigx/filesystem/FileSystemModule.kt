package com.sigx.filesystem

import android.content.Context
import android.net.Uri
import android.util.Base64
import android.util.Log
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import java.io.File

/**
 * File system access module.
 * JS usage: NativeModules.FileSystem.readFile("data.json", callback)
 */
class FileSystemModule(context: Context) : LynxModule(context) {

    companion object {
        private const val TAG = "FileSystemModule"
    }

    @LynxMethod
    fun readFile(path: String?, callback: Callback?) {
        try {
            val file = resolveFile(path ?: "")
            if (!file.exists()) {
                val error = JavaOnlyMap()
                error.putString("error", "File not found: $path")
                callback?.invoke(error)
                return
            }
            callback?.invoke(file.readText())
        } catch (e: Exception) {
            val error = JavaOnlyMap()
            error.putString("error", e.message ?: "Unknown error")
            callback?.invoke(error)
        }
    }

    /**
     * Read a file as raw bytes, returned base64-encoded. Accepts the same
     * paths as `readFile`, plus `file://` URIs and `content://` URIs —
     * i.e. anything a picker hands back (`content://` grants are read via
     * the ContentResolver, not the File API).
     */
    @LynxMethod
    fun readFileBase64(path: String?, callback: Callback?) {
        if (path.isNullOrEmpty()) {
            val error = JavaOnlyMap()
            error.putString("error", "Path is required")
            callback?.invoke(error)
            return
        }
        try {
            val p = path
            val bytes: ByteArray? = if (p.startsWith("content://")) {
                mContext.contentResolver.openInputStream(Uri.parse(p))?.use { it.readBytes() }
            } else {
                val file = resolveFile(p)
                if (!file.exists()) {
                    val error = JavaOnlyMap()
                    error.putString("error", "File not found: $path")
                    callback?.invoke(error)
                    return
                }
                file.readBytes()
            }
            if (bytes == null) {
                val error = JavaOnlyMap()
                error.putString("error", "Could not open stream: $path")
                callback?.invoke(error)
                return
            }
            callback?.invoke(Base64.encodeToString(bytes, Base64.NO_WRAP))
        } catch (e: Exception) {
            val error = JavaOnlyMap()
            error.putString("error", e.message ?: "Unknown error")
            callback?.invoke(error)
        }
    }

    @LynxMethod
    fun writeFile(path: String?, content: String?, callback: Callback?) {
        try {
            val file = resolveFile(path ?: "")
            file.parentFile?.mkdirs()
            file.writeText(content ?: "")
            callback?.invoke(true)
        } catch (e: Exception) {
            val error = JavaOnlyMap()
            error.putString("error", e.message ?: "Unknown error")
            callback?.invoke(error)
        }
    }

    @LynxMethod
    fun deleteFile(path: String?, callback: Callback?) {
        try {
            val p = path ?: ""
            // `content://` is a ContentResolver grant, not a path: `File()`
            // would build a nonexistent relative file under filesDir, whose
            // delete "succeeds" while the picked document is untouched. The
            // app doesn't own that file — say so instead of reporting a
            // deletion that never happened.
            if (p.startsWith("content://")) {
                val error = JavaOnlyMap()
                error.putString(
                    "error",
                    "Cannot delete a content:// URI — the app doesn't own that file: $p",
                )
                callback?.invoke(error)
                return
            }
            val file = resolveFile(p)
            // `delete()` returns false both for "already gone" — the documented
            // no-op, matching iOS — and for a real failure: a non-empty
            // directory, or a read-only path. Only the latter is an error.
            if (!file.delete() && file.exists()) {
                val error = JavaOnlyMap()
                error.putString("error", "Failed to delete: $p")
                callback?.invoke(error)
                return
            }
            callback?.invoke(true)
        } catch (e: Exception) {
            val error = JavaOnlyMap()
            error.putString("error", e.message ?: "Unknown error")
            callback?.invoke(error)
        }
    }

    @LynxMethod
    fun getInfo(path: String?, callback: Callback?) {
        try {
            val file = resolveFile(path ?: "")
            val result = JavaOnlyMap()
            result.putString("uri", file.absolutePath)
            result.putDouble("size", file.length().toDouble())
            result.putBoolean("exists", file.exists())
            result.putBoolean("isDirectory", file.isDirectory)
            result.putDouble("modifiedAt", file.lastModified().toDouble())
            callback?.invoke(result)
        } catch (e: Exception) {
            val error = JavaOnlyMap()
            error.putString("error", e.message ?: "Unknown error")
            callback?.invoke(error)
        }
    }

    @LynxMethod
    fun getDocumentDirectory(): String {
        return mContext.filesDir.absolutePath
    }

    @LynxMethod
    fun getCacheDirectory(): String {
        return mContext.cacheDir.absolutePath
    }

    private fun resolveFile(path: String): File {
        // Accept `file://` URIs (pickers return these) alongside plain paths.
        val p = if (path.startsWith("file://")) Uri.parse(path).path ?: path else path
        val f = File(p)
        return if (f.isAbsolute) f else File(mContext.filesDir, p)
    }
}

