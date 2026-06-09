import Foundation

/// Process-wide pub/sub bus that owns the conversion of native HTTP
/// delegate callbacks into JS-side event payloads. URLSession delegates
/// write here; per-LynxView `HttpPublisher` instances read.
///
/// Mirrors `WebSocketEventBus` — native lifecycle is decoupled from any
/// specific LynxView so in-flight requests survive view recreation.
///
/// Payload keys match the `NativeHttpEvent` interface in `src/types.ts`.
/// Event order per request id: response (once) → progress* → chunk* →
/// done | error.
final class HttpEventBus {

    static let shared = HttpEventBus()

    typealias Payload = [String: Any]
    /// Listeners receive each event as a **JSON string**, not a structured
    /// map — see `emit(_:)`.
    typealias Listener = (String) -> Void

    private let queue = DispatchQueue(label: "com.sigx.http.bus")
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

    func publish(response status: Int, statusText: String, headers: [String: String], id: Int) {
        emit([
            "id": id,
            "type": "response",
            "status": status,
            "statusText": statusText,
            "headers": headers,
        ])
    }

    func publish(chunk base64: String, id: Int) {
        emit([
            "id": id,
            "type": "chunk",
            "data": base64,
        ])
    }

    func publish(progress loaded: Int64, total: Int64, id: Int) {
        emit([
            "id": id,
            "type": "progress",
            "loaded": loaded,
            "total": total,
        ])
    }

    func publish(done id: Int) {
        emit([
            "id": id,
            "type": "done",
        ])
    }

    func publish(error message: String, id: Int) {
        emit([
            "id": id,
            "type": "error",
            "message": message,
        ])
    }

    private func emit(_ payload: Payload) {
        // Lynx 0.5.0 / PrimJS 3.8 regressed `sendGlobalEvent` marshalling of
        // structured params: the one payload carrying a nested map (the
        // `response` event's `headers`) loses its sibling scalar fields
        // (`status`/`statusText`) crossing the bridge, so `Response.status`
        // arrives undefined and `res.ok` is false for every request (#342).
        // Strings cross intact (the base64 body chunks already do), so emit a
        // single JSON string — the JS shim already parses string-form events.
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        let snapshot = queue.sync { listeners }
        for (_, fn) in snapshot { fn(json) }
    }
}
