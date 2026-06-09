import SwiftUI
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

/// One labeled perf metric (milliseconds) shown in the HUD.
public struct DevPerfMetric: Identifiable {
    public let id: String
    public let label: String
    public let value: Double
    public init(label: String, value: Double) {
        self.id = label
        self.label = label
        self.value = value
    }
}

/// Bridges `LynxView` lifecycle callbacks to closures the SwiftUI host can use
/// to drive the dev overlays. Register with `lynxView.addLifecycleClient(_:)`
/// and keep a strong reference for the LynxView's lifetime (the SwiftUI
/// coordinator owns it).
///
/// Lynx fires these on the main thread, but we hop to main defensively before
/// touching `@Published` state.
public final class DevLifecycleClient: NSObject, LynxViewLifecycle {
    private let onLoadingChange: (Bool) -> Void
    private let onError: (String) -> Void
    private let onPerf: ([DevPerfMetric]) -> Void

    /// Accumulated metrics by label, so first-load + update perf and the
    /// timing dictionary merge into one HUD view.
    private var metrics: [String: Double] = [:]

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
        onMain { self.onLoadingChange(true) }
    }
    public func lynxView(_ view: LynxView!, didLoadFinishedWithUrl url: String!) {
        onMain { self.onLoadingChange(false) }
    }
    public func lynxViewDidFirstScreen(_ view: LynxView!) {
        onMain { self.onLoadingChange(false) }
    }

    // ── Errors ─────────────────────────────────────────────────────────────
    // Note the SDK's historical spelling "didRecieveError".
    public func lynxView(_ view: LynxView!, didRecieveError error: Error!) {
        let message = Self.describe(error)
        NSLog("[sigx-dev] Lynx error: %@", message)
        onMain {
            self.onLoadingChange(false)
            self.onError(message)
        }
    }

    /// Lynx hands us a generic `NSError` whose `localizedDescription` is just
    /// "The operation couldn't be completed. (com.lynx.error error 0.)" — the
    /// real message/stack live in `userInfo`. Surface all of it.
    static func describe(_ error: Error?) -> String {
        guard let ns = error as NSError? else { return "Unknown Lynx error" }
        var lines: [String] = []
        for (key, value) in ns.userInfo {
            guard let k = key as? String, k != NSLocalizedDescriptionKey else { continue }
            if let s = value as? String {
                if !s.isEmpty { lines.append("\(k): \(s)") }
            } else if let n = value as? NSNumber {
                lines.append("\(k): \(n)")
            } else {
                // Underlying NSError, arrays, dicts, etc. often carry the real
                // detail — don't drop them.
                lines.append("\(k): \(String(describing: value))")
            }
        }
        // Fall back to the localized description when userInfo had nothing useful.
        if lines.isEmpty {
            lines.append(ns.localizedDescription)
        }
        lines.append("[\(ns.domain) #\(ns.code)]")
        return lines.joined(separator: "\n")
    }

    // ── Perf ───────────────────────────────────────────────────────────────
    public func lynxView(_ view: LynxView!, didReceiveFirstLoadPerf perf: LynxPerformance!) {
        onMain { self.ingest(perf) }
    }
    public func lynxView(_ view: LynxView!, didReceiveUpdatePerf perf: LynxPerformance!) {
        onMain { self.ingest(perf) }
    }

    // Always called on the main queue (via onMain at the call sites), so all
    // `metrics` mutation stays serialized there.
    private func ingest(_ perf: LynxPerformance?) {
        guard let perf = perf else { return }
        if perf.hasActualFMP, perf.actualFMPDuration > 0 {
            metrics["FMP"] = perf.actualFMPDuration
        }
        emit()
    }

    // ── Timing dictionary (LynxTimingListener) ─────────────────────────────
    // The setup/update info dicts carry keyed timing values. We keep only
    // plausible DURATIONS (0 < v < 60s) and skip epoch-style timestamps so the
    // HUD shows meaningful millisecond figures rather than huge clock values.
    public func lynxView(_ lynxView: LynxView!, onSetup info: [AnyHashable: Any]!) {
        onMain { self.mergeTiming(info) }
    }
    public func lynxView(_ lynxView: LynxView!, onUpdate info: [AnyHashable: Any]!, timing updateTiming: [AnyHashable: Any]!) {
        onMain {
            self.mergeTiming(info)
            self.mergeTiming(updateTiming)
        }
    }

    private func mergeTiming(_ dict: [AnyHashable: Any]?) {
        guard let dict = dict else { return }
        var changed = false
        for (key, value) in dict {
            guard let label = key as? String, let num = value as? NSNumber else { continue }
            let ms = num.doubleValue
            if ms > 0, ms < 60_000 {
                metrics[label] = ms
                changed = true
            }
        }
        if changed { emit() }
    }

    private func emit() {
        let snapshot = metrics
            .map { DevPerfMetric(label: $0.key, value: $0.value) }
            .sorted { $0.label < $1.label }
        onMain { self.onPerf(snapshot) }
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

/// React-Native-style red error screen with Reload / Dismiss. Mirrors
/// Android's `ErrorOverlay`.
public struct DevErrorOverlay: View {
    let error: String?
    let onReload: () -> Void
    let onDismiss: () -> Void
    public init(error: String?, onReload: @escaping () -> Void, onDismiss: @escaping () -> Void) {
        self.error = error
        self.onReload = onReload
        self.onDismiss = onDismiss
    }

    public var body: some View {
        if let error = error {
            ZStack {
                Color(red: 0.8, green: 0.0, blue: 0.0).ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Error")
                            .font(.system(size: 24, weight: .bold))
                            .foregroundColor(.white)
                        Text(error)
                            .font(.system(size: 14, design: .monospaced))
                            .foregroundColor(Color(red: 1.0, green: 0.8, blue: 0.8))
                        HStack(spacing: 12) {
                            Button(action: onReload) {
                                Text("Reload").fontWeight(.bold)
                                    .padding(.horizontal, 16).padding(.vertical, 8)
                                    .background(Color.white)
                                    .foregroundColor(Color(red: 0.8, green: 0.0, blue: 0.0))
                                    .cornerRadius(6)
                            }
                            Button(action: onDismiss) {
                                Text("Dismiss")
                                    .padding(.horizontal, 16).padding(.vertical, 8)
                                    .background(Color.white.opacity(0.2))
                                    .foregroundColor(.white)
                                    .cornerRadius(6)
                            }
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
}

/// Translucent corner HUD showing Lynx perf metrics. Mirrors Android's
/// `PerfHud` (color-coded green/amber/red by milliseconds).
public struct DevPerfHud: View {
    let visible: Bool
    let metrics: [DevPerfMetric]
    public init(visible: Bool, metrics: [DevPerfMetric]) {
        self.visible = visible
        self.metrics = metrics
    }

    private func color(for ms: Double) -> Color {
        if ms < 100 { return Color(red: 0.13, green: 0.77, blue: 0.37) }
        if ms < 300 { return Color(red: 0.92, green: 0.70, blue: 0.03) }
        return Color(red: 0.94, green: 0.27, blue: 0.27)
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
                            Text(String(format: "%.1fms", m.value))
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundColor(color(for: m.value))
                        }
                    }
                }
            }
            .padding(10)
            .background(Color(white: 0.12).opacity(0.8))
            .cornerRadius(8)
            .padding(8)
        }
    }
}
