package com.sigx.devclient

import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.lynx.tasm.LynxGlobalMemoryUsageCallback
import com.lynx.tasm.LynxGlobalMemoryUsageResult
import com.lynx.tasm.LynxMemoryUsageQuery
import com.lynx.tasm.LynxViewClientV2
import com.lynx.tasm.performance.performanceobserver.PerformanceEntry
import kotlinx.coroutines.delay

/**
 * Collects Lynx performance entries for the dev HUD.
 *
 * **Registered when the LynxView is built, not when the HUD is shown.** FCP and
 * FMP fire exactly once, during startup; a collector that only subscribed while
 * the overlay was visible would permanently miss them, and the user would
 * toggle the HUD on to find the two most useful numbers blank.
 *
 * Replaces the old `LynxView.forceGetPerf()` poll — the legacy snapshot API,
 * read on a 2-second timer whether or not anything had changed.
 */
class PerfCollector : LynxViewClientV2() {
    private val store = PerfMetricStore()
    private val main = Handler(Looper.getMainLooper())

    /** Compose reads this; only ever written on the UI thread. */
    var metrics by mutableStateOf<List<PerfMetric>>(emptyList())
        private set

    // Non-null parameter: the Java signature is annotated, and a nullable
    // override doesn't compile against it.
    override fun onPerformanceEvent(entry: PerformanceEntry) {
        // Fires on Lynx's REPORTER thread. The header on IPerformanceObserver
        // is explicit that no UI work belongs here, so both the fold and the
        // state write hop to main — which also keeps the store single-threaded
        // without a lock.
        main.post {
            store.ingest(entry)
            metrics = store.snapshot()
        }
    }

    /**
     * Drop everything collected for the previous page.
     *
     * Called from two places, because there are two ways a new page starts:
     * the `AndroidView` factory (first composition, or a genuine view
     * recreation) and `performReload`, which loads into the **existing**
     * LynxView and so never re-runs the factory. Missing the second one would
     * leave the previous page's FCP on screen — a number emitted once per load,
     * so it would sit there looking current forever. iOS gets this from
     * `lynxViewDidStartLoading`, which fires on both paths.
     */
    fun reset() {
        store.clear()
        metrics = emptyList()
    }

    /**
     * One memory reading, folded in on the UI thread.
     *
     * Returns false once the engine has told us the API isn't there, so the
     * HUD's poll can stop asking. An engine older than 4.0.1 raises
     * `NoClassDefFoundError`, and retrying that every 5 s for as long as the
     * overlay is open buys nothing but logcat noise.
     */
    fun pollMemory(): Boolean {
        if (memoryUnavailable) return false
        try {
            LynxMemoryUsageQuery.inst().queryLynxGlobalMemoryUsageAsync(
                object : LynxGlobalMemoryUsageCallback() {
                    override fun onResult(result: LynxGlobalMemoryUsageResult) {
                        // Reporter thread — same hop as onPerformanceEvent, and
                        // reusing the one Handler rather than allocating per poll.
                        main.post {
                            store.setMemory(
                                result.totalBytes.toDouble(),
                                result.elementNodeCount.toDouble(),
                            )
                            metrics = store.snapshot()
                        }
                    }
                }
            )
        } catch (e: Throwable) {
            // Throwable, not Exception: the missing-class case is an Error.
            memoryUnavailable = true
            Log.w(TAG, "memory query unavailable, not polling again: ${e.message}")
            return false
        }
        return true
    }

    private var memoryUnavailable = false

    private companion object {
        const val TAG = "SigxPerfHud"
    }
}

/**
 * Translucent corner HUD showing Lynx engine metrics.
 *
 * The timing half is pushed by [PerfCollector]. Memory is polled, because the
 * engine offers no push channel for it — `LynxMemoryUsageQuery` is a one-shot
 * query — and only while the overlay is visible, so a hidden HUD costs nothing.
 */
@Composable
fun PerfHud(
    visible: Boolean,
    collector: PerfCollector?,
    modifier: Modifier = Modifier
) {
    if (!visible || collector == null) return

    LaunchedEffect(collector) {
        // Stops as soon as the engine says the memory API isn't available,
        // rather than retrying — and cancelled outright when the overlay is
        // hidden, so nothing polls behind a closed HUD.
        while (collector.pollMemory()) {
            delay(MEMORY_POLL_MS)
        }
    }

    Box(
        modifier = modifier
            .padding(8.dp)
            .background(Color(0xCC1E1E1E), RoundedCornerShape(8.dp))
            .padding(10.dp)
    ) {
        Column {
            Text(
                "sigx perf",
                color = Color(0xFF7C3AED),
                fontSize = 11.sp,
                fontFamily = FontFamily.Monospace
            )
            Spacer(modifier = Modifier.height(4.dp))

            val metrics = collector.metrics
            if (metrics.isEmpty()) {
                Text(
                    "Waiting for metrics...",
                    color = Color(0xFF94A3B8),
                    fontSize = 10.sp,
                    fontFamily = FontFamily.Monospace
                )
            } else {
                metrics.forEach { PerfLine(it) }
            }
        }
    }
}

private const val MEMORY_POLL_MS = 5000L

@Composable
private fun PerfLine(metric: PerfMetric) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            metric.label,
            color = Color(0xFF94A3B8),
            fontSize = 10.sp,
            fontFamily = FontFamily.Monospace
        )
        Spacer(modifier = Modifier.width(12.dp))
        Text(
            format(metric),
            color = valueColor(metric),
            fontSize = 10.sp,
            fontFamily = FontFamily.Monospace
        )
    }
}

/**
 * `Locale.US`, not the device locale. `"%.1f".format(x)` follows the phone's
 * setting, so a Swedish device rendered `31,2MB` next to iOS's `33.7MB` — two
 * platforms disagreeing on a number's punctuation, which is exactly what this
 * HUD exists not to do. Diagnostics read the same everywhere.
 */
private fun format(metric: PerfMetric): String = when (metric.unit) {
    PerfUnit.MILLISECONDS -> String.format(java.util.Locale.US, "%.1fms", metric.value)
    PerfUnit.MEGABYTES -> String.format(java.util.Locale.US, "%.1fMB", metric.value)
    PerfUnit.COUNT -> metric.value.toLong().toString()
}

/**
 * The green/amber/red scale is a statement about *durations*. Applying it to
 * megabytes or a node count would imply a budget the HUD has no business
 * asserting, so those render neutral.
 */
private fun valueColor(metric: PerfMetric): Color = when {
    metric.unit != PerfUnit.MILLISECONDS -> Color(0xFFE2E8F0)
    metric.value < 100 -> Color(0xFF22C55E)
    metric.value < 300 -> Color(0xFFEAB308)
    else -> Color(0xFFEF4444)
}
