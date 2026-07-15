import Foundation

/// Process-wide pub/sub bus that converts APNs + UNUserNotificationCenter
/// callbacks into JS-side event payloads. The AppDelegate hook and the
/// notification-center delegate write here; per-LynxView `PushPublisher`
/// instances read.
///
/// Mirrors the `WebSocketEventBus` pattern. Native lifecycle is decoupled from
/// any specific LynxView so events that arrive before a LynxView is built
/// (cold-start payloads, token registrations) can be replayed to subscribers
/// when they attach.
final class PushEventBus {

    static let shared = PushEventBus()

    /// JSON-encodable payload. Wire shape matches the JS-side types in
    /// `src/push.ts`.
    typealias Payload = [String: Any]

    /// Listeners receive each event as a **JSON string** — see `emit`.
    typealias Listener = (String, String) -> Void

    private let queue = DispatchQueue(label: "com.sigx.notifications.bus")
    private var listeners: [(token: UUID, fn: Listener)] = []

    /// Cached cold-start tap, JSON-encoded. Cleared after the JS shim retrieves
    /// it via `Notifications.getInitialNotification()`. Stored regardless of
    /// whether a LynxView has attached yet — the JS shim polls on first call.
    private(set) var initialResponse: String?

    /// Cached most-recent device token so a JS subscriber that attaches after
    /// registration completes still receives it on subscribe. APNs returns
    /// the same token across registrations, so caching is safe.
    private(set) var lastToken: String?

    /// `true` once the app has first reached `.active`. Set from the
    /// `didBecomeActiveNotification` observer installed in `didFinishLaunching`.
    ///
    /// This is the cold-start discriminator: a tap that launched the process
    /// arrives BEFORE the app first becomes active; an in-session tap (app was
    /// backgrounded, user tapped) arrives after. Keying on this rather than on
    /// "has JS drained the initial notification yet" is what stops an early
    /// `getInitialNotification()` from stranding a launch tap — see
    /// `captureInitialResponseIfColdStart`.
    private(set) var hasBecomeActive = false

    @discardableResult
    func addListener(_ fn: @escaping Listener) -> UUID {
        let token = UUID()
        // Snapshot the cached token in the same critical section as the
        // listener append so we either replay-then-deliver or skip-then-deliver
        // — no torn-state where a concurrent publishToken slips between the
        // two and the listener sees the token twice. The replay itself runs
        // OUTSIDE the queue so a listener that re-enters the bus (e.g.
        // immediately subscribes a second listener, or calls publishToken
        // recursively) doesn't deadlock on the serial queue.
        let cached: String? = queue.sync {
            listeners.append((token, fn))
            return lastToken
        }
        if let cached = cached {
            fn(PushEventChannel.token, cached)
        }
        return token
    }

    func removeListener(_ token: UUID) {
        queue.sync { listeners.removeAll { $0.token == token } }
    }

    // MARK: - Publish

    func publishToken(_ token: String, platform: String = "apns") {
        guard let json = Self.encode(["token": token, "platform": platform]) else { return }
        queue.sync { lastToken = json }
        emit(channel: PushEventChannel.token, json: json)
    }

    func publishTokenError(_ message: String) {
        emit(channel: PushEventChannel.tokenError, payload: ["error": message])
    }

    func publishMessage(title: String?, body: String?, data: [String: String], foreground: Bool) {
        var payload: Payload = [
            "data": data,
            "foreground": foreground,
        ]
        if let title = title { payload["title"] = title }
        if let body = body { payload["body"] = body }
        emit(channel: PushEventChannel.message, payload: payload)
    }

    func publishResponse(notificationId: String, data: [String: String], actionIdentifier: String) {
        emit(channel: PushEventChannel.response, payload: Self.responsePayload(
            notificationId: notificationId,
            data: data,
            actionIdentifier: actionIdentifier
        ))
    }

    static func responsePayload(
        notificationId: String,
        data: [String: String],
        actionIdentifier: String
    ) -> Payload {
        return [
            "notificationId": notificationId,
            "data": data,
            "actionIdentifier": actionIdentifier,
        ]
    }

    /// Encode a payload for the bridge. Returns nil for anything
    /// `JSONSerialization` rejects — callers drop the event rather than emit a
    /// half-formed one.
    static func encode(_ payload: Payload) -> String? {
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return nil }
        return json
    }

    /// Close the cold-start window. Any tap from here on is an in-session tap
    /// (app was backgrounded, user tapped) and belongs on the response channel,
    /// where a live LynxView is listening.
    func markBecameActive() {
        queue.sync { hasBecomeActive = true }
    }

    /// Capture a tap as the cold-start payload IF the app has not yet become
    /// active — i.e. this tap is what launched the process — AND nothing has
    /// been captured yet. Returns `true` if the call stashed it; the caller
    /// must then NOT publish on the response channel, or an app wiring both
    /// `getInitialNotification()` and `addNotificationResponseListener` would
    /// deep-link twice.
    ///
    /// The discriminator is "has the app ever been active", NOT "has JS asked
    /// for the initial notification yet": the old consume-closes-the-window
    /// rule stranded a launch tap whenever JS called `getInitialNotification()`
    /// in the gap between launch and `didReceive` — the normal path for a local
    /// notification launched from a terminated state (#619).
    func captureInitialResponseIfColdStart(
        notificationId: String,
        data: [String: String],
        actionIdentifier: String
    ) -> Bool {
        return queue.sync {
            guard !hasBecomeActive, initialResponse == nil else { return false }
            // Encode inside the lock so the stashed value and the return agree:
            // if encoding fails we return false and the caller publishes rather
            // than the tap being silently dropped.
            initialResponse = Self.encode(Self.responsePayload(
                notificationId: notificationId,
                data: data,
                actionIdentifier: actionIdentifier
            ))
            return initialResponse != nil
        }
    }

    /// Drain and return the cold-start payload (one-shot — subsequent calls
    /// return nil). Does NOT touch the cold-start window; that is owned by
    /// `markBecameActive` — see `captureInitialResponseIfColdStart`.
    func consumeInitialResponse() -> String? {
        return queue.sync {
            let p = initialResponse
            initialResponse = nil
            return p
        }
    }

    private func emit(channel: String, payload: Payload) {
        guard let json = Self.encode(payload) else {
            NSLog("[lynx-notifications] dropped unencodable payload on \(channel)")
            return
        }
        emit(channel: channel, json: json)
    }

    private func emit(channel: String, json: String) {
        // Lynx 0.5.0 / PrimJS 3.8 regressed `sendGlobalEvent` marshalling of
        // structured params: a payload carrying a nested map loses its sibling
        // scalar fields crossing the bridge (#342). EVERY payload here nests
        // `data`, so `title` / `body` / `foreground` / `notificationId` /
        // `actionIdentifier` all arrived undefined in JS while `data` survived
        // — which is why the bug read as "the data is there but tap routing
        // does nothing". Strings cross intact, so emit a single JSON string;
        // the JS shim already parses string-form events. Same fix, same reason
        // as `HttpEventBus.emit` / `WebRTCEventBus.emit`.
        let snapshot = queue.sync { listeners }
        for (_, fn) in snapshot { fn(channel, json) }
    }
}

/// Stable event-channel names. These also appear in the JS shim — keep in sync.
enum PushEventChannel {
    static let token = "__sigxPushToken"
    static let tokenError = "__sigxPushTokenError"
    static let message = "__sigxPushMessage"
    static let response = "__sigxNotificationResponse"
}
