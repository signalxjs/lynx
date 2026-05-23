package com.sigx.background

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.future.await
import kotlinx.coroutines.withTimeout
import java.util.UUID

/**
 * `CoroutineWorker` that publishes a fire event on [BackgroundEventBus] and
 * suspends until JS calls `Background.completeTask(runId, …)` — or until
 * WorkManager's ~10-minute budget runs out, whichever comes first.
 *
 * The worker is enqueued by [BackgroundModule.register] as a
 * `PeriodicWorkRequest` (when `minimumInterval` is set) or
 * `OneTimeWorkRequest`. The same worker class services both kinds — the
 * `KEY_TASK_NAME` input data carries the JS-side `taskName`.
 *
 * ## Headless-JS caveat (v0.1)
 *
 * WorkManager can fire while the host Activity (and therefore the LynxView
 * that owns the JS heap) is destroyed. In that case the publish reaches no
 * JS-side listener and the await times out → `Result.retry()`. WorkManager
 * will then re-enqueue with backoff; in practice the next fire after the
 * user opens the app will succeed.
 *
 * A proper headless-JS host (foreground service hosting a detached
 * LynxView) is out of scope for v0.1 — tracked as a follow-up.
 */
class SigxBackgroundWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val taskName = inputData.getString(KEY_TASK_NAME) ?: run {
            Log.w(TAG, "Worker fired without $KEY_TASK_NAME; failing")
            return Result.failure()
        }
        val runId = UUID.randomUUID().toString()
        val future = BackgroundEventBus.publishFire(taskName, runId)
        return try {
            // Leave headroom under the platform's ~10-minute ceiling.
            val success = withTimeout(WORKER_TIMEOUT_MS) { future.await() }
            if (success) Result.success() else Result.retry()
        } catch (_: TimeoutCancellationException) {
            BackgroundEventBus.abandonRun(runId)
            Log.w(TAG, "Worker for $taskName timed out after ${WORKER_TIMEOUT_MS}ms")
            // Retry rather than failure so WorkManager re-enqueues with
            // backoff (typical reason: no LynxView was alive to run the
            // handler — see the headless-JS caveat in the kdoc).
            Result.retry()
        } catch (t: Throwable) {
            BackgroundEventBus.abandonRun(runId)
            Log.w(TAG, "Worker for $taskName failed: ${t.message}")
            Result.failure()
        }
    }

    companion object {
        const val KEY_TASK_NAME = "sigx_background_task_name"

        /**
         * ~9 minutes. WorkManager's hard budget is 10 minutes; we cut it
         * short so our own cleanup (publish abandon + log) has room to run
         * before the OS kills the worker.
         */
        private const val WORKER_TIMEOUT_MS = 9L * 60L * 1000L

        private const val TAG = "SigxBackgroundWorker"
    }
}
