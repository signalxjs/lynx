package com.sigx.background

import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.tasm.LynxView
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap

/**
 * Process-wide pub/sub bus that converts WorkManager fires into JS-side
 * event payloads, and routes JS completions back to the suspended worker so
 * `doWork()` can return `Result.success` / `Result.failure`.
 *
 * Mirrors [com.sigx.notifications.PushEventBus]. Decoupled from any specific
 * LynxView so workers fired before a view exists can still publish — the
 * worker side gates on the completion future, with a bounded grace period
 * to wait for a JS handler to bind.
 *
 * Wire shape on the `__sigxBackgroundFire` channel:
 *     { "taskName": String, "runId": String }
 */
internal object BackgroundEventBus {

    /**
     * Single lock guards [listeners]. Listener invocations happen OUTSIDE
     * the lock so a callback that re-enters the bus doesn't deadlock.
     */
    private val lock = Any()
    private val listeners = mutableListOf<Pair<UUID, (String, JavaOnlyMap) -> Unit>>()

    /**
     * Completion futures keyed by `runId`. The worker awaits these; JS
     * calls [completeRun] from `Background.completeTask(runId, success)`.
     *
     * `ConcurrentHashMap` so the bus + worker thread + JS bridge thread can
     * all touch it without taking the listener lock.
     */
    private val inflight = ConcurrentHashMap<String, CompletableFuture<Boolean>>()

    fun addListener(fn: (String, JavaOnlyMap) -> Unit): UUID {
        val token = UUID.randomUUID()
        synchronized(lock) { listeners.add(token to fn) }
        return token
    }

    fun removeListener(token: UUID) {
        synchronized(lock) { listeners.removeAll { it.first == token } }
    }

    /**
     * Called by [SigxBackgroundWorker]. Registers a completion future and
     * publishes a fire event to JS. The caller awaits the returned future
     * (with a timeout) to decide the worker's `Result`.
     */
    fun publishFire(taskName: String, runId: String): CompletableFuture<Boolean> {
        val future = CompletableFuture<Boolean>()
        inflight[runId] = future
        val payload = JavaOnlyMap().apply {
            putString("taskName", taskName)
            putString("runId", runId)
        }
        emit(Channel.FIRE, payload)
        return future
    }

    /** Called from `Background.completeTask`. No-op if the run has already timed out. */
    fun completeRun(runId: String, success: Boolean) {
        inflight.remove(runId)?.complete(success)
    }

    /** Called by the worker if it times out — releases the future entry. */
    fun abandonRun(runId: String) {
        inflight.remove(runId)
    }

    private fun emit(channel: String, payload: JavaOnlyMap) {
        // Snapshot inside the lock so a concurrent add/remove can't tear the
        // iteration. Call listeners OUTSIDE so a callback that re-enters
        // doesn't deadlock.
        val snapshot = synchronized(lock) { listeners.toList() }
        for ((_, fn) in snapshot) fn(channel, payload)
    }

    object Channel {
        const val FIRE = "__sigxBackgroundFire"
    }
}
