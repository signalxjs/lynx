import SwiftUI
import UIKit
import Lynx

// ───────────────────────────────────────────────────────────────────────────
// Dev overlays for the iOS dev client — brings iOS to parity with Android's
// `DevLynxScreen` (loading spinner, error overlay, perf HUD) plus the new
// cross-platform connection-state banner.
//
// The overlays are plain SwiftUI views driven by observable state. A
// `DevLifecycleClient` (registered on the LynxView via `addLifecycleClient:`)
// translates Lynx lifecycle callbacks — load start/finish, errors, perf — into
// that state. All of this is DEBUG-only; the template gates it behind
// `#if DEBUG` and dev mode.
// ───────────────────────────────────────────────────────────────────────────

/// Bridges `LynxView` lifecycle callbacks to closures the SwiftUI host can use
/// to drive the dev overlays. Register with `lynxView.addLifecycleClient(_:)`
/// and keep a strong reference for the LynxView's lifetime (the SwiftUI
/// coordinator owns it).
///
/// Conforms to `LynxViewLifecycleV2`, which composes the old
/// `LynxViewBaseLifecycle` callbacks with `LynxPerformanceObserverProtocol` —
/// so one registration serves loading, errors *and* the typed 4.0 performance
/// entries. The loading/error halves still arrive on the main thread;
/// `onPerformanceEvent` does not (see below).
public final class DevLifecycleClient: NSObject, LynxViewLifecycle, LynxViewLifecycleV2 {
    private let onLoadingChange: (Bool) -> Void
    private let onError: (String) -> Void
    private let onPerf: ([DevPerfMetric]) -> Void

    /// Folds engine entries into the shared HUD vocabulary. Only ever touched
    /// on the main queue, which is what keeps it lock-free.
    private let store = PerfMetricStore()

    /// Last URL the LynxView finished loading — used to derive the dev-server
    /// endpoint when mirroring errors to the `sigx dev` terminal.
    private var lastLoadedUrl: String?

    public init(
        onLoadingChange: @escaping (Bool) -> Void,
        onError: @escaping (String) -> Void,
        onPerf: @escaping ([DevPerfMetric]) -> Void
    ) {
        self.onLoadingChange = onLoadingChange
        self.onError = onError
        self.onPerf = onPerf
        super.init()
    }

    private func onMain(_ work: @escaping () -> Void) {
        if Thread.isMainThread { work() } else { DispatchQueue.main.async(execute: work) }
    }

    // ── Loading lifecycle ──────────────────────────────────────────────────
    public func lynxViewDidStartLoading(_ view: LynxView!) {
        onMain {
            // Drop the previous page's numbers. FCP is emitted once per load,
            // so a stale one would sit in the HUD looking current forever.
            self.store.clear()
            self.emit()
            self.onLoadingChange(true)
        }
    }
    public func lynxView(_ view: LynxView!, didLoadFinishedWithUrl url: String!) {
        lastLoadedUrl = url
        onMain { self.onLoadingChange(false) }
    }
    public func lynxViewDidFirstScreen(_ view: LynxView!) {
        onMain { self.onLoadingChange(false) }
    }

    // ── Errors ─────────────────────────────────────────────────────────────
    // Note the SDK's historical spelling "didRecieveError".
    public func lynxView(_ view: LynxView!, didRecieveError error: Error!) {
        let message = Self.describe(error)
        // Drop dev-server / HMR artifacts (e.g. "Failed to load CSS update
        // file …hot-update.json") — they fire constantly and aren't app errors.
        if Self.isDevNoise(message) {
            NSLog("[sigx-dev] (filtered HMR noise) %@", message)
            return
        }
        NSLog("[sigx-dev] Lynx error: %@", message)
        // Mirror the error to the `sigx dev` terminal so it isn't trapped on the
        // red screen. Fire-and-forget; deduped server-side against the JS path.
        DevServerReporter.report(bundleUrl: lastLoadedUrl, message: message)
        onMain {
            self.onLoadingChange(false)
            self.onError(message)
        }
    }

    /// Dev-server / HMR artifacts that aren't real app errors. Checks only the
    /// HEADLINE (before `detailMarker`) so a stack frame mentioning "hot-update"
    /// can't suppress a real error.
    static func isDevNoise(_ message: String) -> Bool {
        let head = (message.components(separatedBy: detailMarker).first ?? message).lowercased()
        return head.contains("hot-update") || head.contains("failed to load css update file")
    }

    /// Separates the human-readable REASON (shown by default) from the
    /// details/stack (hidden behind "Show stacktrace") with `detailMarker`.
    static let detailMarker = "##SIGX_STACKTRACE##"

    /// Lynx routes JS/internal errors as a JSON blob (`{…"error":"{…rawError:
    /// {message,stack}…}"…}`). Dig out the human message + stack so the overlay
    /// shows those instead of the raw JSON. Returns `(head, nil)` unchanged when
    /// it isn't a JSON blob.
    static func cleanReason(_ head: String) -> (reason: String, stack: String?) {
        let trimmed = head.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("{"),
              let data = trimmed.data(using: .utf8),
              let outer = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return (head, nil) }

        // The inner error may be a JSON string under "error", or already a dict.
        var node = outer
        if let errStr = outer["error"] as? String,
           let d = errStr.data(using: .utf8),
           let inner = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            node = inner
        } else if let errObj = outer["error"] as? [String: Any] {
            node = errObj
        }
        let raw = node["rawError"] as? [String: Any]
        let reason = (raw?["message"] as? String) ?? (node["message"] as? String)
        let stack = (raw?["stack"] as? String) ?? (node["stack"] as? String)
        return (reason ?? head, stack)
    }

    /// Lynx hands us a generic `NSError` whose `localizedDescription` is just
    /// "The operation couldn't be completed. (com.lynx.error error 0.)" — the
    /// real message/stack live in `userInfo`. We surface the **reason first**,
    /// then everything else after `detailMarker` so the overlay can collapse it.
    static func describe(_ error: Error?) -> String {
        guard let ns = error as NSError? else { return "Unknown Lynx error" }
        let info = ns.userInfo
        var consumed: Set<String> = [NSLocalizedDescriptionKey]

        var rawReason: String?
        for k in ["message", "error_message", "reason"] {
            if let s = info[k] as? String, !s.isEmpty { rawReason = s; consumed.insert(k); break }
        }
        // Unwrap Lynx's JSON-blob errors → concise reason + stack.
        let (head, jsonStack) = cleanReason(rawReason ?? ns.localizedDescription)

        // Details: the parsed/keyed stacks first, then remaining userInfo, then ctx.
        var details: [String] = []
        if let jsonStack = jsonStack, !jsonStack.isEmpty { details.append("stack:\n\(jsonStack)") }
        for k in ["stackInfo", "stack", "error_stack"] {
            if let s = info[k] as? String, !s.isEmpty, !consumed.contains(k) {
                details.append("\(k):\n\(s)")
                consumed.insert(k)
            }
        }
        for (k, value) in info where !consumed.contains(k) {
            if let s = value as? String {
                if !s.isEmpty { details.append("\(k): \(s)") }
            } else if let n = value as? NSNumber {
                details.append("\(k): \(n)")
            } else {
                details.append("\(k): \(String(describing: value))")
            }
        }
        details.append("[\(ns.domain) #\(ns.code)]") // always present → details is never empty

        return head + "\n" + detailMarker + "\n" + details.joined(separator: "\n")
    }

    // ── Perf (LynxPerformanceObserverProtocol) ─────────────────────────────
    //
    // Replaces two older sources: `didReceiveFirstLoadPerf` / `didReceiveUpdatePerf`
    // (of which only `actualFMPDuration` was ever read) and the untyped
    // `onSetup` / `onUpdate:timing:` dictionaries, which were scraped with a
    // "keep any number between 0 and 60s and hope it's a duration" heuristic
    // and labelled with whatever string keys the engine happened to emit. That
    // is why the two platforms' HUDs never agreed.
    public func onPerformanceEvent(_ entry: LynxPerformanceEntry) {
        // Fires on the REPORTER thread — the protocol header says so
        // explicitly, and warns against UI work here. Hop before touching the
        // store or the published state.
        onMain {
            self.store.ingest(entry)
            self.emit()
        }
    }

    /// Memory has no push channel — the HUD polls `LynxMemoryUsageQuery` and
    /// feeds the result back through here. Already on the main queue.
    public func applyMemory(totalBytes: Double, elementNodeCount: Double) {
        store.setMemory(totalBytes: totalBytes, elementNodeCount: elementNodeCount)
        emit()
    }

    /// Called on the main queue only.
    private func emit() {
        onPerf(store.snapshot())
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Overlay views
// ───────────────────────────────────────────────────────────────────────────

/// Thin top banner shown while the dev-server connection is down. Auto-hides
/// when the JS streamer reconnects (the server restart path also reloads the
/// app, which clears it). Mirrors Android's `ConnectionBanner`.
public struct ConnectionBanner: View {
    let connected: Bool
    public init(connected: Bool) { self.connected = connected }

    public var body: some View {
        if connected {
            EmptyView()
        } else {
            Text("⚡ Disconnected from dev server — reconnecting…")
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .padding(.horizontal, 12)
                .background(Color(red: 1.0, green: 0.42, blue: 0.42))
                .transition(.move(edge: .top).combined(with: .opacity))
        }
    }
}

/// Centered spinner shown while a (re)load is in flight.
public struct DevLoadingOverlay: View {
    let visible: Bool
    public init(visible: Bool) { self.visible = visible }

    public var body: some View {
        if visible {
            ProgressView()
                .progressViewStyle(.circular)
                .padding(16)
                .background(Color.black.opacity(0.6))
                .cornerRadius(10)
        }
    }
}

/// React-Native-style red error screen with Reload / Copy / Dismiss and a
/// LogBox-style multi-error pager. Mirrors Android's `ErrorOverlay`.
///
/// The host (`ContentView`) keeps passing the latest error via the existing
/// `error: String?` prop; this view accumulates them internally so a burst of
/// errors is paginated (‹ N/M ›) instead of overwritten. Dismiss drops the
/// current one and only clears the host binding (via `onDismiss`) when the last
/// one goes — so a `nil` from the host means "all clear".
public struct DevErrorOverlay: View {
    let error: String?
    let onReload: () -> Void
    let onDismiss: () -> Void

    @State private var errors: [String] = []
    @State private var index: Int = 0
    @State private var copyToast: String?
    @State private var showStack: Bool = false

    public init(error: String?, onReload: @escaping () -> Void, onDismiss: @escaping () -> Void) {
        self.error = error
        self.onReload = onReload
        self.onDismiss = onDismiss
    }

    /// Split a `describe()` string into (reason, details?) on `detailMarker`.
    private func split(_ s: String) -> (reason: String, details: String?) {
        let parts = s.components(separatedBy: DevLifecycleClient.detailMarker)
        let reason = parts[0].trimmingCharacters(in: .whitespacesAndNewlines)
        let details = parts.count > 1 ? parts[1].trimmingCharacters(in: .whitespacesAndNewlines) : nil
        return (reason, details)
    }

    /// Full text (reason + details, marker stripped) for Copy.
    private func fullText(_ s: String) -> String {
        s.components(separatedBy: DevLifecycleClient.detailMarker)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .joined(separator: "\n\n")
    }

    private static let red = Color(red: 0.8, green: 0.0, blue: 0.0)

    private func ingest(_ value: String?) {
        guard let value = value, !value.isEmpty else { errors = []; index = 0; return }
        if errors.last != value {
            errors.append(value)
            index = errors.count - 1
        }
    }

    private func copy(_ text: String, label: String) {
        UIPasteboard.general.string = text
        copyToast = label
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { copyToast = nil }
    }

    private func dismissCurrent() {
        if errors.count <= 1 {
            onDismiss() // clears the host binding → onChange(nil) hides the overlay
        } else {
            errors.remove(at: index)
            if index >= errors.count { index = errors.count - 1 }
        }
    }

    public var body: some View {
        Group {
            if !errors.isEmpty {
                let current = errors[min(index, errors.count - 1)]
                let parts = split(current)
                ZStack {
                    Self.red.ignoresSafeArea()
                    // Header + action bar are pinned; only the message/stack
                    // scrolls — so the reason, the pager and the buttons are
                    // always reachable without scrolling past the stack.
                    VStack(alignment: .leading, spacing: 0) {
                        HStack {
                            Text("Error")
                                .font(.system(size: 24, weight: .bold))
                                .foregroundColor(.white)
                            Spacer()
                            if errors.count > 1 {
                                HStack(spacing: 14) {
                                    Button(action: { if index > 0 { index -= 1 } }) {
                                        Image(systemName: "chevron.left").foregroundColor(.white)
                                    }.disabled(index == 0)
                                    Text("\(index + 1)/\(errors.count)")
                                        .font(.system(size: 15, weight: .semibold, design: .monospaced))
                                        .foregroundColor(.white)
                                    Button(action: { if index < errors.count - 1 { index += 1 } }) {
                                        Image(systemName: "chevron.right").foregroundColor(.white)
                                    }.disabled(index == errors.count - 1)
                                }
                            }
                        }
                        .padding(.horizontal, 24).padding(.top, 24).padding(.bottom, 12)

                        ScrollView {
                            VStack(alignment: .leading, spacing: 12) {
                                // Reason — shown by default, selectable.
                                Text(parts.reason)
                                    .font(.system(size: 14, design: .monospaced))
                                    .foregroundColor(Color(red: 1.0, green: 0.8, blue: 0.8))
                                    .textSelection(.enabled)
                                if let details = parts.details {
                                    Button(action: { showStack.toggle() }) {
                                        Text(showStack ? "▾ Hide stacktrace" : "▸ Show stacktrace")
                                            .font(.system(size: 13, weight: .semibold))
                                            .foregroundColor(.white)
                                    }
                                    if showStack {
                                        Text(details)
                                            .font(.system(size: 12, design: .monospaced))
                                            .foregroundColor(Color(red: 1.0, green: 0.8, blue: 0.8).opacity(0.85))
                                            .textSelection(.enabled)
                                    }
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 24)
                        }

                        VStack(alignment: .leading, spacing: 10) {
                            HStack(spacing: 12) {
                                // Navigation is the ‹ N/M › pager up top — keep the
                                // action row to three so it never cramps/wraps.
                                button("Reload", filled: true, action: onReload)
                                button(copyToast ?? "Copy", filled: false) { copy(fullText(current), label: "Copied") }
                                button("Dismiss", filled: false, action: dismissCurrent)
                            }
                            Text("sigx dev client — shake device or open the dev menu for tools")
                                .font(.system(size: 11))
                                .foregroundColor(.white.opacity(0.6))
                        }
                        .padding(24)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
        .onAppear { ingest(error) }
        .onChange(of: error) { ingest($0) }
        .onChange(of: index) { _ in showStack = false } // collapse stack per error
    }

    @ViewBuilder
    private func button(_ label: String, filled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label).fontWeight(filled ? .bold : .regular)
                .padding(.horizontal, 16).padding(.vertical, 8)
                .background(filled ? Color.white : Color.white.opacity(0.2))
                .foregroundColor(filled ? Self.red : .white)
                .cornerRadius(6)
        }
    }
}

/// Translucent corner HUD showing Lynx engine metrics. Renders the same
/// vocabulary, in the same order, as Android's `PerfHud` — see
/// `PerfMetrics.swift`.
///
/// The timing half is pushed by `DevLifecycleClient`. Memory is polled, because
/// the engine offers no push channel for it (`LynxMemoryUsageQuery` is a
/// one-shot query), and only while the overlay is visible, so a hidden HUD
/// costs nothing.
public struct DevPerfHud: View {
    let visible: Bool
    let metrics: [DevPerfMetric]
    /// Invoked on the main queue with each memory reading. Optional so the HUD
    /// still renders in previews and hosts that don't wire the collector.
    let onMemory: ((Double, Double) -> Void)?

    private static let pollInterval: TimeInterval = 5

    public init(
        visible: Bool,
        metrics: [DevPerfMetric],
        onMemory: ((Double, Double) -> Void)? = nil
    ) {
        self.visible = visible
        self.metrics = metrics
        self.onMemory = onMemory
    }

    /// The green/amber/red scale is a statement about *durations*. Applying it
    /// to megabytes or a node count would imply a budget the HUD has no
    /// business asserting, so those render neutral.
    private func color(for metric: DevPerfMetric) -> Color {
        guard metric.unit == .milliseconds else {
            return Color(red: 0.89, green: 0.91, blue: 0.94)
        }
        if metric.value < 100 { return Color(red: 0.13, green: 0.77, blue: 0.37) }
        if metric.value < 300 { return Color(red: 0.92, green: 0.70, blue: 0.03) }
        return Color(red: 0.94, green: 0.27, blue: 0.27)
    }

    private func format(_ metric: DevPerfMetric) -> String {
        switch metric.unit {
        case .milliseconds: return String(format: "%.1fms", metric.value)
        case .megabytes: return String(format: "%.1fMB", metric.value)
        case .count: return String(Int(metric.value))
        }
    }

    public var body: some View {
        if visible {
            VStack(alignment: .leading, spacing: 2) {
                Text("sigx perf")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(Color(red: 0.49, green: 0.23, blue: 0.93))
                if metrics.isEmpty {
                    Text("Waiting for metrics…")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(Color(red: 0.58, green: 0.64, blue: 0.72))
                } else {
                    ForEach(metrics) { m in
                        HStack {
                            Text(m.label)
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundColor(Color(red: 0.58, green: 0.64, blue: 0.72))
                            Spacer(minLength: 12)
                            Text(format(m))
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundColor(color(for: m))
                        }
                    }
                }
            }
            .padding(10)
            .background(Color(white: 0.12).opacity(0.8))
            .cornerRadius(8)
            .padding(8)
            .task(id: visible) {
                guard onMemory != nil else { return }
                // Cancelled automatically when the HUD is hidden or torn down,
                // so nothing polls behind a closed overlay.
                while !Task.isCancelled {
                    DevMemoryProbe.query { total, nodes in
                        onMemory?(total, nodes)
                    }
                    try? await Task.sleep(nanoseconds: UInt64(Self.pollInterval * 1_000_000_000))
                }
            }
        }
    }
}

/// One-shot engine memory reading for the HUD.
///
/// Deliberately not routed through `@sigx/lynx-observability` — the dev client
/// must work in any app, including one that never installs that package, so it
/// talks to the engine API directly.
enum DevMemoryProbe {
    /// Calls back on the **main queue** with `(totalBytes, elementNodeCount)`.
    static func query(_ completion: @escaping (Double, Double) -> Void) {
        LynxMemoryUsageQuery.sharedInstance().queryLynxGlobalMemoryUsageAsync { result in
            // Fires on the report thread; the HUD is SwiftUI state.
            let total = Double(result.totalBytes)
            let nodes = Double(result.elementNodeCount)
            DispatchQueue.main.async { completion(total, nodes) }
        }
    }
}
