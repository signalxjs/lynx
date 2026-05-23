import Foundation

/// Process-wide pub/sub for audio events (`onEnd`, `onMeter`) that the JS
/// shim subscribes to via `GlobalEventEmitter`. Mirrors the pattern from
/// `@sigx/lynx-notifications`/`@sigx/lynx-websocket` — a global bus
/// decoupled from any specific LynxView, plus a per-LynxView publisher
/// (`AudioPublisher`) that pumps each emission into JS through
/// `LynxView.sendGlobalEvent(name, withParams:)`.
final class AudioEventBus {

    static let shared = AudioEventBus()

    typealias Payload = [String: Any]
    typealias Listener = (String, Payload) -> Void

    private let queue = DispatchQueue(label: "com.sigx.audio.bus")
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

    func publishPlayerEnd(id: Int64) {
        emit(channel: "__sigxAudioEnd:\(id)", payload: ["id": id])
    }

    func publishMeter(id: Int64, peak: Double, avg: Double) {
        emit(channel: "__sigxAudioMeter:\(id)", payload: [
            "id": id,
            "peak": peak,
            "avg": avg,
        ])
    }

    private func emit(channel: String, payload: Payload) {
        let snapshot = queue.sync { listeners }
        for (_, fn) in snapshot { fn(channel, payload) }
    }
}
