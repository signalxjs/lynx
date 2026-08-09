package com.sigx.observability

import android.content.Context
import android.util.Log
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap
import com.lynx.tasm.LynxGlobalMemoryUsageCallback
import com.lynx.tasm.LynxGlobalMemoryUsageResult
import com.lynx.tasm.LynxInstanceMemoryUsage
import com.lynx.tasm.LynxMemoryCollectionStatus
import com.lynx.tasm.LynxMemoryUsageQuery
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Lynx engine memory-usage query (requires Lynx >= 4.0.1).
 * JS usage: NativeModules.Observability.queryMemoryUsage({ timeoutMs }, callback)
 *
 * The reading is **process-global** — one query covers every LynxView in the
 * app — so this is a plain module rather than a per-view publisher, and there
 * is nothing to dispose.
 *
 * Note this is the *query*, not the passive `memory` performance entry. The
 * entry stream is gated behind `enable_memory_monitor`; the query is not —
 * `LynxTemplateRender.registerMemoryUsageFetcherIfNeeded()` registers every
 * render unconditionally, so this works with no engine setting.
 */
class ObservabilityModule(context: Context) : LynxModule(context) {

    private companion object {
        const val TAG = "SigxObservability"
    }

    @LynxMethod
    fun queryMemoryUsage(params: ReadableMap?, callback: Callback?) {
        // A Lynx Callback is single-shot, and invoking it twice takes the whole
        // bridge down rather than just this call. The engine should call us
        // exactly once, but "the timeout fires, then the slow instance
        // completes" is precisely the shape that would prove otherwise.
        val settled = AtomicBoolean(false)
        val settle = { map: JavaOnlyMap ->
            if (settled.compareAndSet(false, true)) callback?.invoke(map)
            Unit
        }

        val cb = object : LynxGlobalMemoryUsageCallback() {
            // Runs on Lynx's *report* thread — not the UI thread and not the JS
            // thread. Building a JavaOnlyMap here is fine: Callback marshals to
            // JS itself, which is the same contract UpdatesModule relies on from
            // its download executor.
            //
            // The parameter is non-null: upstream always delivers a result, even
            // with no live instances (a completed result with zero bytes) and on
            // timeout (a partial one). Matching that is required — a nullable
            // override doesn't compile against the annotated Java signature.
            override fun onResult(result: LynxGlobalMemoryUsageResult) {
                settle(
                    try {
                        serialize(result)
                    } catch (e: Throwable) {
                        // Serialization runs on the report thread, where an
                        // uncaught throw would strand the JS promise forever
                        // rather than surfacing anywhere useful.
                        Log.w(TAG, "serializing memory usage failed: ${e.message}")
                        errorMap(e.message ?: "serializing memory usage failed")
                    },
                )
            }
        }

        try {
            val query = LynxMemoryUsageQuery.inst()
            // JS numbers arrive as doubles. Absent means "engine default", which
            // the no-timeout overload already expresses — better than hardcoding
            // the 2000 ms the engine currently uses.
            val timeoutMs = params?.takeIf { it.hasKey("timeoutMs") }?.getDouble("timeoutMs")?.toLong()
            if (timeoutMs != null) query.queryLynxGlobalMemoryUsageAsync(cb, timeoutMs)
            else query.queryLynxGlobalMemoryUsageAsync(cb)
        } catch (e: Throwable) {
            // Throwable, not Exception: an engine older than 4.0.1 raises
            // NoClassDefFoundError here, and a promise that never settles is a
            // worse failure than a described one.
            Log.w(TAG, "queryMemoryUsage failed: ${e.message}")
            settle(errorMap(e.message ?: "queryMemoryUsage failed"))
        }
    }

    /** `{ error }` on failure — CONVENTIONS.md C4. */
    private fun errorMap(message: String) = JavaOnlyMap().apply { putString("error", message) }

    /**
     * Every number goes over as a double, deliberately.
     *
     * Byte counts are int64 and the bridge has no putLong; putDouble is the
     * repo's established carrier and is exact for integers below 2^53 (~9 PB).
     * Sending the counts the same way costs nothing and means iOS and Android
     * put identical wire types on every field, so one JS normalizer serves both.
     */
    private fun serialize(r: LynxGlobalMemoryUsageResult): JavaOnlyMap = JavaOnlyMap().apply {
        // Enum to string at the boundary: JS never sees a magic int, and a
        // future enum member degrades to "unknown" instead of to a number that
        // means something else.
        putString("collectionStatus", when (r.collectionStatus) {
            LynxMemoryCollectionStatus.COMPLETED -> "completed"
            LynxMemoryCollectionStatus.TIMEOUT -> "timeout"
            else -> "unknown"
        })
        putDouble("collectionStartMs", r.collectionStartMs.toDouble())
        putDouble("collectionDurationMs", r.collectionDurationMs.toDouble())
        putDouble("collectionTimeoutMs", r.collectionTimeoutMs.toDouble())
        putDouble("expectedInstanceCount", r.expectedInstanceCount.toDouble())
        putDouble("completedInstanceCount", r.completedInstanceCount.toDouble())
        putDouble("totalBytes", r.totalBytes.toDouble())
        putDouble("appBytes", r.appBytes.toDouble())
        putDouble("ratioToApp", r.ratioToApp)
        putDouble("elementBytes", r.elementBytes.toDouble())
        putDouble("elementNodeCount", r.elementNodeCount.toDouble())
        putDouble("viewBytes", r.viewBytes.toDouble())
        putDouble("mainThreadRuntimeBytes", r.mainThreadRuntimeBytes.toDouble())
        putDouble("backgroundThreadRuntimeBytes", r.backgroundThreadRuntimeBytes.toDouble())
        putArray("instances", JavaOnlyArray().apply {
            r.instances?.forEach { pushMap(serializeInstance(it)) }
        })
    }

    private fun serializeInstance(i: LynxInstanceMemoryUsage): JavaOnlyMap = JavaOnlyMap().apply {
        // -1 when the instance was never fully attached. Passed through raw and
        // normalized to null in JS — putNull isn't exercised anywhere else in
        // this repo and this isn't the place to discover whether it round-trips.
        putDouble("instanceId", i.instanceId.toDouble())
        putString("pageId", i.pageId ?: "")
        putString("url", i.url ?: "")
        putDouble("totalBytes", i.totalBytes.toDouble())
        putDouble("elementBytes", i.elementBytes.toDouble())
        putDouble("elementNodeCount", i.elementNodeCount.toDouble())
        putDouble("viewBytes", i.viewBytes.toDouble())
        putDouble("mainThreadRuntimeBytes", i.mainThreadRuntimeBytes.toDouble())
        putDouble("backgroundThreadRuntimeBytes", i.backgroundThreadRuntimeBytes.toDouble())
        putString("btsRuntimeGroupId", i.btsRuntimeGroupId ?: "")
        // `viewDetail` is deliberately not serialized — see the README Gotchas.
    }
}
