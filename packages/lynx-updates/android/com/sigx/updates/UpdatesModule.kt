package com.sigx.updates

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap
import com.lynx.tasm.TemplateData
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/**
 * JS bridge for OTA updates.
 * JS usage: NativeModules.Updates.downloadUpdate({...}, callback)
 *
 * Downloads run on a single-thread executor (single-flight is also enforced
 * in [UpdateDownloader]); everything else is cheap file/state work.
 */
class UpdatesModule(context: Context) : LynxModule(context) {

    companion object {
        private const val TAG = "SigxUpdates"
        private val executor = Executors.newSingleThreadExecutor { r ->
            Thread(r, "sigx-updates").apply { isDaemon = true }
        }
        private val mainHandler = Handler(Looper.getMainLooper())
    }

    private fun error(message: String, code: String? = null): JavaOnlyMap {
        val map = JavaOnlyMap()
        map.putString("error", message)
        if (code != null) map.putString("code", code)
        return map
    }

    private fun ok(): JavaOnlyMap {
        val map = JavaOnlyMap()
        map.putBoolean("ok", true)
        return map
    }

    @LynxMethod
    fun getInstalledRuntimeVersion(): String {
        return UpdateStore.installedRuntimeVersion(mContext)
    }

    @LynxMethod
    fun getPlatform(): String = "android"

    @LynxMethod
    fun getCurrentUpdate(callback: Callback?) {
        try {
            val map = JavaOnlyMap()
            val updateId = UpdateStore.launchedUpdateId
            if (updateId != null) {
                map.putString("updateId", updateId)
                map.putBoolean("isEmbedded", false)
                val metaFile = UpdateStore.updateJsonFile(mContext, updateId)
                if (metaFile.exists()) {
                    try {
                        val meta = JSONObject(metaFile.readText())
                        map.putString("version", meta.optString("version"))
                    } catch (_: Exception) { /* metadata is best-effort */ }
                }
            } else {
                map.putBoolean("isEmbedded", true)
            }
            map.putString("runtimeVersion", UpdateStore.installedRuntimeVersion(mContext))
            // Store-shipped app version — providers receive it as
            // UpdateCheckContext.embeddedVersion.
            val versionName = runCatching {
                mContext.packageManager.getPackageInfo(mContext.packageName, 0).versionName
            }.getOrNull()
            map.putString("embeddedVersion", versionName ?: "")
            map.putBoolean("isFirstLaunchAfterUpdate", UpdateStore.isFirstLaunchAfterUpdate)
            map.putBoolean("didRollBack", UpdateStore.didRollBack)
            UpdateStore.rolledBackUpdateId?.let { map.putString("rolledBackUpdateId", it) }
            callback?.invoke(map)
        } catch (e: Exception) {
            callback?.invoke(error(e.message ?: "getCurrentUpdate failed"))
        }
    }

    @LynxMethod
    fun getState(callback: Callback?) {
        try {
            val state = UpdateStore.readState(mContext)
            val map = JavaOnlyMap()
            if (state != null) {
                map.putString("currentUpdateId", state.currentUpdateId ?: "")
                map.putString("previousUpdateId", state.previousUpdateId ?: "")
                map.putString("pendingUpdateId", state.pendingUpdateId ?: "")
                map.putInt("pendingLaunchAttempts", state.pendingLaunchAttempts)
                map.putInt("maxLaunchAttempts", state.maxLaunchAttempts)
                map.putString("lastRollbackUpdateId", state.lastRollbackUpdateId ?: "")
                map.putString("lastRollbackReason", state.lastRollbackReason ?: "")
            }
            map.putString("runningUpdateId", UpdateStore.launchedUpdateId ?: "")
            callback?.invoke(map)
        } catch (e: Exception) {
            callback?.invoke(error(e.message ?: "getState failed"))
        }
    }

    @LynxMethod
    fun downloadUpdate(params: ReadableMap?, callback: Callback?) {
        val url = params?.getString("url")
        val sha256 = params?.getString("sha256")
        val updateId = params?.getString("updateId")
        val runtimeVersion = params?.getString("runtimeVersion")
        val manifestJson = try { params?.getString("manifestJson") } catch (_: Exception) { null }
        if (url.isNullOrEmpty() || sha256.isNullOrEmpty() || updateId.isNullOrEmpty()) {
            callback?.invoke(error("url, sha256 and updateId are required"))
            return
        }

        // Refuse incompatible bundles at the door — defense in depth on top
        // of the JS-side check.
        val installed = UpdateStore.installedRuntimeVersion(mContext)
        if (!runtimeVersion.isNullOrEmpty() && runtimeVersion != installed) {
            callback?.invoke(error(
                "Update requires runtime $runtimeVersion but binary is $installed",
                "E_RUNTIME_MISMATCH",
            ))
            return
        }

        val headers = mutableMapOf<String, String>()
        try {
            val headerMap = params.getMap("headers")
            if (headerMap != null) {
                val it = headerMap.keySetIterator()
                while (it.hasNextKey()) {
                    val key = it.nextKey()
                    headerMap.getString(key)?.let { v -> headers[key] = v }
                }
            }
        } catch (_: Exception) { /* headers optional */ }

        executor.execute {
            val result = UpdateDownloader.download(
                mContext, url, sha256, updateId, headers, manifestJson ?: "{}")
            if (result == null) {
                callback?.invoke(ok())
            } else {
                val code = when {
                    result.startsWith("E_DOWNLOAD_IN_PROGRESS") -> "E_DOWNLOAD_IN_PROGRESS"
                    result.startsWith("E_HASH_MISMATCH") -> "hash-mismatch"
                    else -> null
                }
                callback?.invoke(error(result, code))
            }
        }
    }

    @LynxMethod
    fun applyOnNextLaunch(updateId: String?, callback: Callback?) {
        if (updateId.isNullOrEmpty()) {
            callback?.invoke(error("updateId is required"))
            return
        }
        val result = UpdateStore.stagePending(mContext, updateId)
        callback?.invoke(if (result == null) ok() else error(result))
    }

    @LynxMethod
    fun applyNow(updateId: String?, callback: Callback?) {
        if (updateId.isNullOrEmpty()) {
            callback?.invoke(error("updateId is required"))
            return
        }
        val bundle = UpdateStore.bundleFile(mContext, updateId)
        if (!bundle.exists()) {
            callback?.invoke(error("Update $updateId is not on disk"))
            return
        }
        val view = UpdateStore.currentView()
        if (view == null) {
            callback?.invoke(error("No LynxView attached — cannot reload in place", "E_NO_VIEW"))
            return
        }
        // Stage first so a crash mid-reload still gets crash-guarded rollback
        // (the reload bypasses the startup resolver).
        UpdateStore.stagePending(mContext, updateId)
        UpdateStore.recordReloadAttempt(mContext, updateId)
        mainHandler.post {
            try {
                val bytes = File(bundle.absolutePath).readBytes()
                view.reloadAndInit()
                view.renderTemplateWithBaseUrl(bytes, TemplateData.empty(), "file://${bundle.absolutePath}")
                // JS context is replaced — the callback never reaches the old
                // context on success, which is the documented contract.
            } catch (e: Exception) {
                Log.e(TAG, "applyNow reload failed: ${e.message}")
                callback?.invoke(error(e.message ?: "Reload failed", "apply-failed"))
            }
        }
    }

    @LynxMethod
    fun markReady(callback: Callback?) {
        try {
            UpdateStore.markReady(mContext)
            callback?.invoke(ok())
        } catch (e: Exception) {
            callback?.invoke(error(e.message ?: "markReady failed"))
        }
    }

    @LynxMethod
    fun setRollbackOptions(params: ReadableMap?, callback: Callback?) {
        try {
            val max = params?.getInt("maxFailedLaunches") ?: 2
            UpdateStore.setMaxLaunchAttempts(mContext, max)
            callback?.invoke(ok())
        } catch (e: Exception) {
            callback?.invoke(error(e.message ?: "setRollbackOptions failed"))
        }
    }

    @LynxMethod
    fun clearUpdates(callback: Callback?) {
        try {
            UpdateStore.clearAll(mContext)
            callback?.invoke(ok())
        } catch (e: Exception) {
            callback?.invoke(error(e.message ?: "clearUpdates failed"))
        }
    }
}
