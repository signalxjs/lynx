package com.sigx.devclient

import android.util.Log
import com.lynx.tasm.performance.performanceobserver.LoadBundleEntry
import com.lynx.tasm.performance.performanceobserver.MetricActualFmpEntry
import com.lynx.tasm.performance.performanceobserver.MetricFcpEntry
import com.lynx.tasm.performance.performanceobserver.PerformanceEntry
import com.lynx.tasm.performance.performanceobserver.PerformanceMetric
import com.lynx.tasm.performance.performanceobserver.PipelineEntry

/**
 * The dev HUD's metric vocabulary — the Android half.
 *
 * **`PerfVocabulary.KEYS` below must stay identical, in the same order, to the
 * Swift list in `ios/Sources/SigxDevClient/PerfMetrics.swift`.** A JS test
 * (`packages/lynx-dev-client/__tests__/perf-hud-vocabulary.test.ts`) reads both
 * files and fails if they drift. That parity is the point of the exercise: the
 * two HUDs previously showed different numbers under different names, so a
 * reading taken on one platform could not be compared to the other.
 *
 * Everything here derives from the typed 4.0 performance entries
 * (`onPerformanceEvent`), not from the legacy `LynxPerfMetric` snapshot the HUD
 * used to poll.
 */
object PerfVocabulary {
    /** Startup, from the `loadBundle` entry — set once per page load. */
    const val FCP = "FCP"
    const val FMP = "FMP"
    const val BUNDLE = "Bundle"
    const val JS_CORE = "JS core"

    /** The last render pipeline — replaced on every pipeline entry. */
    const val PIPELINE = "Pipeline"
    const val MTS = "MTS"
    const val LAYOUT = "Layout"
    const val UI_FLUSH = "UI flush"

    /** Engine memory, polled (there is no push channel for it). */
    const val MEMORY = "Lynx mem"
    const val NODES = "Nodes"

    /**
     * Display order. The HUD renders exactly these, in this order, skipping any
     * that haven't arrived yet.
     */
    val KEYS: List<String> = listOf(
        FCP, FMP, BUNDLE, JS_CORE,
        PIPELINE, MTS, LAYOUT, UI_FLUSH,
        MEMORY, NODES,
    )
}

/** How a value is rendered, and whether the duration colour scale applies. */
enum class PerfUnit { MILLISECONDS, MEGABYTES, COUNT }

/** One line in the HUD. */
data class PerfMetric(val label: String, val value: Double, val unit: PerfUnit)

/**
 * Accumulates entries into the current metric set.
 *
 * Not thread-safe by itself: `onPerformanceEvent` fires on Lynx's **reporter
 * thread**, so every mutation is funnelled onto the UI thread by the caller
 * (`PerfHud`). Keeping the hop at the boundary rather than in here means the
 * Compose state is only ever written from one thread.
 */
class PerfMetricStore {
    private companion object {
        const val TAG = "SigxPerfHud"
    }

    private val values = LinkedHashMap<String, PerfMetric>()

    /** `entryType.name` keys already reported as unmapped — logged once each. */
    private val unrecognised = HashSet<String>()

    /** A snapshot in `PerfVocabulary.KEYS` order, omitting what hasn't arrived. */
    fun snapshot(): List<PerfMetric> = PerfVocabulary.KEYS.mapNotNull { values[it] }

    fun clear() {
        values.clear()
        // `unrecognised` is deliberately NOT cleared: it exists to report each
        // unmapped entry once per process, not once per page load.
    }

    private fun put(label: String, value: Double, unit: PerfUnit) {
        // A zero or negative duration means the engine didn't record that
        // stage, not that it was instant — showing "0.0ms" would be a lie.
        if (value <= 0 || !value.isFinite()) return
        values[label] = PerfMetric(label, value, unit)
    }

    private fun putSpan(label: String, start: Double, end: Double) {
        // Entry timestamps are epoch-based; only their difference is meaningful,
        // and a missing endpoint arrives as 0 rather than as null.
        if (start <= 0 || end <= 0) return
        put(label, end - start, PerfUnit.MILLISECONDS)
    }

    private fun putMetric(label: String, metric: PerformanceMetric?) {
        metric?.let { put(label, it.duration, PerfUnit.MILLISECONDS) }
    }

    /**
     * Fold one engine entry in. Unknown entry types are ignored, not guessed at.
     *
     * An entry that maps to nothing is logged once per `entryType.name`. That
     * costs nothing and answers the question that is otherwise very expensive
     * to answer from an empty HUD: is the engine sending entries we don't
     * understand, or sending nothing at all? (#982 was two hours of exactly
     * that ambiguity, on the JS side.)
     */
    fun ingest(entry: PerformanceEntry) {
        // Keyed on whether the entry matched a known CLASS, not on whether the
        // value map grew: a second pipeline entry only overwrites existing keys,
        // so a size comparison would report every render as unmapped.
        if (foldIn(entry)) return
        val key = "${entry.entryType}.${entry.name}"
        if (unrecognised.add(key)) Log.d(TAG, "no HUD mapping for entry: $key")
    }

    /** @return true when the entry matched a type the HUD knows about. */
    private fun foldIn(entry: PerformanceEntry): Boolean {
        var matched = false
        // LoadBundleEntry extends PipelineEntry, so it must be checked first —
        // otherwise the startup-only fields would never be read.
        if (entry is LoadBundleEntry) {
            matched = true
            putSpan(PerfVocabulary.BUNDLE, entry.loadBundleStart, entry.loadBundleEnd)
            putSpan(PerfVocabulary.JS_CORE, entry.loadCoreStart, entry.loadCoreEnd)
            putMetric(PerfVocabulary.FCP, entry.fcp)
        }
        if (entry is PipelineEntry) {
            matched = true
            putSpan(PerfVocabulary.PIPELINE, entry.pipelineStart, entry.pipelineEnd)
            putSpan(PerfVocabulary.MTS, entry.mtsRenderStart, entry.mtsRenderEnd)
            putSpan(PerfVocabulary.LAYOUT, entry.layoutStart, entry.layoutEnd)
            putSpan(
                PerfVocabulary.UI_FLUSH,
                entry.paintingUiOperationExecuteStart,
                entry.paintingUiOperationExecuteEnd,
            )
            putMetric(PerfVocabulary.FMP, entry.actualFmp)
        }
        // The engine also emits FCP/FMP as standalone metric entries on some
        // paths; take them from there too rather than depending on which one
        // this build happens to send.
        if (entry is MetricFcpEntry) {
            matched = true
            putMetric(PerfVocabulary.FCP, entry.fcp)
        }
        if (entry is MetricActualFmpEntry) {
            matched = true
            putMetric(PerfVocabulary.FMP, entry.actualFmp)
        }
        return matched
    }

    /** Memory comes from a query, not an entry — see `PerfHud`'s poll. */
    fun setMemory(totalBytes: Double, elementNodeCount: Double) {
        put(PerfVocabulary.MEMORY, totalBytes / 1_048_576.0, PerfUnit.MEGABYTES)
        put(PerfVocabulary.NODES, elementNodeCount, PerfUnit.COUNT)
    }
}
