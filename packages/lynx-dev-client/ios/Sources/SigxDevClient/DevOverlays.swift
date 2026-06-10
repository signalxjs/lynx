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
        // Drop dev-server / HMR artifacts (e.g. "Failed to load CSS update
        // file …hot-update.json") — they fire constantly and aren't app errors.
        if Self.isDevNoise(message) {
            NSLog("[sigx-dev] (filtered HMR noise) %@", message)
            return
        }
        NSLog("[sigx-dev] Lynx error: %@", message)
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
