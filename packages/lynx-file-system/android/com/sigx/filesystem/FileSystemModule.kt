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
        try {
            val p = path ?: ""
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
            val file = resolveFile(path ?: "")
            val deleted = file.delete()
            callback?.invoke(deleted)
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

