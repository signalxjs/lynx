package com.sigx.filesystem

import android.content.Context
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
        val f = File(path)
        return if (f.isAbsolute) f else File(mContext.filesDir, path)
    }
}

