import Foundation
import Lynx

// ───────────────────────────────────────────────────────────────────────────
// The dev HUD's metric vocabulary — the iOS half.
//
// `PerfVocabulary.keys` below must stay identical, in the same order, to the
// Kotlin list in
// `android/src/main/kotlin/com/sigx/devclient/PerfMetrics.kt`. A JS test
// (`packages/lynx-dev-client/__tests__/perf-hud-vocabulary.test.ts`) reads both
// files and fails if they drift. That parity is the point of the exercise: the
// two HUDs previously showed different numbers under different names, so a
// reading taken on one platform could not be compared to the other.
//
// Everything here derives from the typed 4.0 performance entries
// (`onPerformanceEvent`), not from the untyped `onSetup` / `onUpdate:timing:`
// dictionaries the HUD used to scrape.
// ───────────────────────────────────────────────────────────────────────────

public enum PerfVocabulary {
    /// Startup, from the `loadBundle` entry — set once per page load.
    public static let fcp = "FCP"
    public static let fmp = "FMP"
    public static let bundle = "Bundle"
    public static let jsCore = "JS core"

    /// The last render pipeline — replaced on every pipeline entry.
    public static let pipeline = "Pipeline"
    public static let mts = "MTS"
    public static let layout = "Layout"
    public static let uiFlush = "UI flush"

    /// Engine memory, polled (there is no push channel for it).
    public static let memory = "Lynx mem"
    public static let nodes = "Nodes"

    /// Display order. The HUD renders exactly these, in this order, skipping
    /// any that haven't arrived yet.
    public static let keys: [String] = [
        fcp, fmp, bundle, jsCore,
        pipeline, mts, layout, uiFlush,
        memory, nodes,
    ]
}

/// How a value is rendered, and whether the duration colour scale applies.
public enum PerfUnit {
    case milliseconds
    case megabytes
    case count
}

/// One line in the HUD.
public struct DevPerfMetric: Identifiable {
    public let id: String
    public let label: String
    public let value: Double
    public let unit: PerfUnit

    public init(label: String, value: Double, unit: PerfUnit = .milliseconds) {
        self.id = label
        self.label = label
        self.value = value
        self.unit = unit
    }
}

/// Accumulates entries into the current metric set.
///
/// Not thread-safe by itself: `onPerformanceEvent` fires on Lynx's **reporter
/// thread**, so every mutation is funnelled onto the main queue by the caller
/// (`DevLifecycleClient`). Keeping the hop at the boundary rather than in here
/// means the published state is only ever written from one thread.
public final class PerfMetricStore {
    private var values: [String: DevPerfMetric] = [:]

    public init() {}

    /// A snapshot in `PerfVocabulary.keys` order, omitting what hasn't arrived.
    public func snapshot() -> [DevPerfMetric] {
        PerfVocabulary.keys.compactMap { values[$0] }
    }

    public func clear() { values.removeAll() }

    private func put(_ label: String, _ value: Double, _ unit: PerfUnit) {
        // A zero or negative duration means the engine didn't record that
        // stage, not that it was instant — showing "0.0ms" would be a lie.
        guard value > 0, value.isFinite else { return }
        values[label] = DevPerfMetric(label: label, value: value, unit: unit)
    }

    private func putSpan(_ label: String, _ start: NSNumber?, _ end: NSNumber?) {
        // Entry timestamps are epoch-based; only their difference is
        // meaningful, and a missing endpoint arrives as 0 rather than as nil.
        guard let s = start?.doubleValue, let e = end?.doubleValue, s > 0, e > 0 else { return }
        put(label, e - s, .milliseconds)
    }

    /// `duration` is a non-optional `NSNumber` in the header, so the optional
    /// chain stops at `metric`.
    private func putMetric(_ label: String, _ metric: LynxPerformanceMetric?) {
        guard let metric = metric else { return }
        put(label, metric.duration.doubleValue, .milliseconds)
    }

    /// `entryType.name` keys already reported as unmapped — logged once each.
    private var unrecognised: Set<String> = []

    /**
     Fold one engine entry in. Unknown entry types are ignored, not guessed at.

     An entry that matches no known class is logged once per `entryType.name`.
     That costs nothing and answers the question that is otherwise very
     expensive to answer from an empty HUD: is the engine sending entries we
     don't understand, or sending nothing at all? (#982 was hours of exactly
     that ambiguity, on the JS side.)
     */
    public func ingest(_ entry: LynxPerformanceEntry) {
        if fold(entry) { return }
        let key = "\(entry.entryType).\(entry.name)"
        if unrecognised.insert(key).inserted {
            NSLog("[sigx-dev] no HUD mapping for entry: %@", key)
        }
    }

    /// - Returns: true when the entry matched a type the HUD knows about.
    private func fold(_ entry: LynxPerformanceEntry) -> Bool {
        var matched = false
        // LynxLoadBundleEntry subclasses LynxPipelineEntry, so it is checked
        // first — otherwise the startup-only fields would never be read.
        if let load = entry as? LynxLoadBundleEntry {
            matched = true
            putSpan(PerfVocabulary.bundle, load.loadBundleStart, load.loadBundleEnd)
            putSpan(PerfVocabulary.jsCore, load.loadCoreStart, load.loadCoreEnd)
            putMetric(PerfVocabulary.fcp, load.fcp)
        }
        if let pipeline = entry as? LynxPipelineEntry {
            matched = true
            putSpan(PerfVocabulary.pipeline, pipeline.pipelineStart, pipeline.pipelineEnd)
            putSpan(PerfVocabulary.mts, pipeline.mtsRenderStart, pipeline.mtsRenderEnd)
            putSpan(PerfVocabulary.layout, pipeline.layoutStart, pipeline.layoutEnd)
            putSpan(
                PerfVocabulary.uiFlush,
                pipeline.paintingUiOperationExecuteStart,
                pipeline.paintingUiOperationExecuteEnd
            )
            putMetric(PerfVocabulary.fmp, pipeline.actualFmp)
        }
        // The engine also emits FCP/FMP as standalone metric entries on some
        // paths; take them from there too rather than depending on which one
        // this build happens to send.
        if let fcpEntry = entry as? LynxMetricFcpEntry {
            matched = true
            putMetric(PerfVocabulary.fcp, fcpEntry.fcp)
        }
        if let fmpEntry = entry as? LynxMetricActualFmpEntry {
            matched = true
            putMetric(PerfVocabulary.fmp, fmpEntry.actualFmp)
        }
        return matched
    }

    /// Memory comes from a query, not an entry — see the HUD's poll.
    public func setMemory(totalBytes: Double, elementNodeCount: Double) {
        put(PerfVocabulary.memory, totalBytes / 1_048_576.0, .megabytes)
        put(PerfVocabulary.nodes, elementNodeCount, .count)
    }
}
