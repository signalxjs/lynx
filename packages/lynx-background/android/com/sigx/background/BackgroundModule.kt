package com.sigx.background

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap
import java.util.concurrent.TimeUnit

/**
 * Periodic background tasks via `WorkManager`.
 *
 * JS usage: `NativeModules.Background.<method>(...)`.
 *
 * Task name → `WorkManager` unique-name mapping is one-to-one. We use
 * `ExistingPeriodicWorkPolicy.UPDATE` so a second `register()` call with the
 * same name swaps the constraints without spawning a duplicate.
 */
class BackgroundModule(context: Context) : LynxModule(context) {

    companion object {
        private const val TAG = "BackgroundModule"
        private const val PREFS = "com.sigx.background.tasks"
        private const val UNIQUE_PREFIX = "sigx.bg."
    }

    @LynxMethod
    fun register(taskName: String?, options: ReadableMap?, callback: Callback?) {
        if (taskName.isNullOrEmpty()) {
            callback?.invoke(JavaOnlyMap().apply { putString("error", "taskName is required") })
            return
        }
        try {
            val minimumInterval = options?.takeIf { it.hasKey("minimumInterval") }
                ?.getDouble("minimumInterval")
                ?.toLong()
            val requiresNetwork = options?.takeIf { it.hasKey("requiresNetwork") }
                ?.getBoolean("requiresNetwork") ?: false
            val requiresCharging = options?.takeIf { it.hasKey("requiresCharging") }
                ?.getBoolean("requiresCharging") ?: false

            val constraints = Constraints.Builder()
                .setRequiredNetworkType(if (requiresNetwork) NetworkType.CONNECTED else NetworkType.NOT_REQUIRED)
                .setRequiresCharging(requiresCharging)
                .build()

            val data = Data.Builder()
                .putString(SigxBackgroundWorker.KEY_TASK_NAME, taskName)
                .build()

            val workManager = WorkManager.getInstance(mContext)
            val uniqueName = UNIQUE_PREFIX + taskName

            if (minimumInterval != null && minimumInterval > 0) {
                // WorkManager floors periodic intervals at 15 minutes — passing
                // a smaller value would throw. Clamp on our side so callers
                // get predictable behavior instead of an exception.
                val intervalSeconds = maxOf(minimumInterval, 15L * 60L)
                val request = PeriodicWorkRequestBuilder<SigxBackgroundWorker>(
                    intervalSeconds, TimeUnit.SECONDS,
                )
                    .setConstraints(constraints)
                    .setInputData(data)
                    .build()
                workManager.enqueueUniquePeriodicWork(
                    uniqueName,
                    ExistingPeriodicWorkPolicy.UPDATE,
                    request,
                )
            } else {
                val request = OneTimeWorkRequestBuilder<SigxBackgroundWorker>()
                    .setConstraints(constraints)
                    .setInputData(data)
                    .build()
                workManager.enqueueUniqueWork(
                    uniqueName,
                    ExistingWorkPolicy.REPLACE,
                    request,
                )
            }

            persistTaskName(taskName)
            callback?.invoke(JavaOnlyMap().apply { putBoolean("ok", true) })
        } catch (e: Exception) {
            Log.w(TAG, "register($taskName) failed: ${e.message}")
            callback?.invoke(JavaOnlyMap().apply { putString("error", e.message ?: "unknown") })
        }
    }

    @LynxMethod
    fun unregister(taskName: String?, callback: Callback?) {
        if (taskName.isNullOrEmpty()) {
            callback?.invoke(JavaOnlyMap().apply { putBoolean("ok", false) })
            return
        }
        try {
            WorkManager.getInstance(mContext).cancelUniqueWork(UNIQUE_PREFIX + taskName)
            forgetTaskName(taskName)
            callback?.invoke(JavaOnlyMap().apply { putBoolean("ok", true) })
        } catch (e: Exception) {
            callback?.invoke(JavaOnlyMap().apply { putString("error", e.message ?: "unknown") })
        }
    }

    @LynxMethod
    fun getRegistered(callback: Callback?) {
        val arr = JavaOnlyArray()
        for (name in loadTaskNames()) arr.pushString(name)
        callback?.invoke(arr)
    }

    @LynxMethod
    fun completeTask(runId: String?, success: Boolean, callback: Callback?) {
        if (runId.isNullOrEmpty()) {
            callback?.invoke(JavaOnlyMap().apply { putBoolean("ok", false) })
            return
        }
        BackgroundEventBus.completeRun(runId, success)
        callback?.invoke(JavaOnlyMap().apply { putBoolean("ok", true) })
    }

    // MARK: - Persistence
    //
    // SharedPreferences stores just the set of taskName strings. The actual
    // WorkRequest is owned by WorkManager (which persists it across reboots
    // on its own), so we don't need to round-trip constraints here — calling
    // `register()` again on cold start re-applies them.

    private fun persistTaskName(taskName: String) {
        val prefs = mContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val current = prefs.getStringSet("names", emptySet())?.toMutableSet() ?: mutableSetOf()
        current.add(taskName)
        prefs.edit().putStringSet("names", current).apply()
    }

    private fun forgetTaskName(taskName: String) {
        val prefs = mContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val current = prefs.getStringSet("names", emptySet())?.toMutableSet() ?: mutableSetOf()
        current.remove(taskName)
        prefs.edit().putStringSet("names", current).apply()
    }

    private fun loadTaskNames(): Set<String> {
        return mContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getStringSet("names", emptySet()) ?: emptySet()
    }
}
