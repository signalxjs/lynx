import Foundation

/// Process-wide pub/sub bus that owns the conversion of native WebSocket
/// callbacks into JS-side event payloads. Sockets, sessions, and OS
/// delegates write here; per-LynxView `WebSocketPublisher` instances read.
///
/// Mirrors the publisher pattern used elsewhere in the repo
/// (`LinkingState`, `SafeAreaPublisher`, …): native lifecycle is decoupled
/// from any specific LynxView so events survive view recreation and
/// per-view subscribers can fan out without holding onto the WS task.
final class WebSocketEventBus {

    static let shared = WebSocketEventBus()

    /// JSON-encodable payload pushed to JS as the single
    /// `__sigxWebSocketEvent` global event. Keys match the `NativeEvent`
    /// interface in `src/websocket.ts`.
    typealias Payload = [String: Any]
    typealias Listener = (Payload) -> Void

    private let queue = DispatchQueue(label: "com.sigx.websocket.bus")
    private var listeners: [(token: UUID, fn: Listener)] = []

    @discardableResult
    func addListener(_ fn: @escaping Listener) -> UUID {
        let token = UUID()
        queue.sync { listeners.append((token, fn)) }
        return token
    }

    func removeListener(_ token: UUID) {
        queue.sync { listeners.removeAll { $0.token == token } }
    }

    // MARK: - Publish

    func publish(open protocolStr: String, extensions: String, id: Int) {
        emit([
            "id": id,
            "type": "open",
            "protocol": protocolStr,
            "extensions": extensions,
        ])
    }

    func publish(messageText text: String, id: Int) {
        emit([
            "id": id,
            "type": "message",
            "data": text,
            "isBinary": false,
        ])
    }

    func publish(messageBinary base64: String, id: Int) {
        emit([
            "id": id,
            "type": "message",
            "binary": base64,
            "isBinary": true,
        ])
    }

    func publish(error message: String, id: Int) {
        emit([
            "id": id,
            "type": "error",
            "data": message,
        ])
    }

    func publish(close code: Int, reason: String, wasClean: Bool, id: Int) {
        emit([
            "id": id,
            "type": "close",
            "code": code,
            "reason": reason,
            "wasClean": wasClean,
        ])
    }

    private func emit(_ payload: Payload) {
        let snapshot = queue.sync { listeners }
        for (_, fn) in snapshot { fn(payload) }
    }
}
