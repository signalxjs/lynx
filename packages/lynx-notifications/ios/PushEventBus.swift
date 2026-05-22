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
    /// `src/push.ts` (channel name carried as `__channel`).
    typealias Payload = [String: Any]
    typealias Listener = (String, Payload) -> Void

    private let queue = DispatchQueue(label: "com.sigx.notifications.bus")
    private var listeners: [(token: UUID, fn: Listener)] = []

    /// Cached cold-start tap. Cleared after the JS shim retrieves it via
    /// `Notifications.getInitialNotification()`. Stored regardless of whether
    /// a LynxView has attached yet — the JS shim polls on first call.
    private(set) var initialResponse: Payload?

    /// Cached most-recent device token so a JS subscriber that attaches after
    /// registration completes still receives it on subscribe. APNs returns
    /// the same token across registrations, so caching is safe.
    private(set) var lastToken: Payload?

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
        let cached: Payload? = queue.sync {
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
        let payload: Payload = ["token": token, "platform": platform]
        queue.sync { lastToken = payload }
        emit(channel: PushEventChannel.token, payload: payload)
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
        let payload: Payload = [
            "notificationId": notificationId,
            "data": data,
            "actionIdentifier": actionIdentifier,
        ]
        emit(channel: PushEventChannel.response, payload: payload)
    }

    /// Stash a cold-start tap. `application(_:didFinishLaunchingWithOptions:)`
    /// runs before any LynxView exists; the payload is held until JS asks for
    /// it via `getInitialNotification()`.
    func captureInitialResponse(notificationId: String, data: [String: String], actionIdentifier: String) {
        queue.sync {
            initialResponse = [
                "notificationId": notificationId,
                "data": data,
                "actionIdentifier": actionIdentifier,
            ]
        }
    }

    /// Drain and return the cold-start payload (one-shot — subsequent calls
    /// return nil).
    func consumeInitialResponse() -> Payload? {
        return queue.sync {
            let p = initialResponse
            initialResponse = nil
            return p
        }
    }

    private func emit(channel: String, payload: Payload) {
        let snapshot = queue.sync { listeners }
        for (_, fn) in snapshot { fn(channel, payload) }
    }
}

/// Stable event-channel names. These also appear in the JS shim — keep in sync.
enum PushEventChannel {
    static let token = "__sigxPushToken"
    static let tokenError = "__sigxPushTokenError"
    static let message = "__sigxPushMessage"
    static let response = "__sigxNotificationResponse"
}
