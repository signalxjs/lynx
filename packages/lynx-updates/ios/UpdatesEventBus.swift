import Foundation
import CryptoKit

/// Module → publisher event bus (the `BackgroundEventBus` pattern). The
/// module emits download progress / foreground events here; the per-LynxView
/// `UpdatesLifecyclePublisher` pumps them into JS via `sendGlobalEvent` on
/// the `__sigxUpdatesEvent` channel.
final class UpdatesEventBus {

    static let shared = UpdatesEventBus()
    static let channel = "__sigxUpdatesEvent"

    typealias Payload = [String: Any]
    typealias Listener = (Payload) -> Void

    private let queue = DispatchQueue(label: "com.sigx.updates.bus")
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

    func emit(_ payload: Payload) {
        let snapshot = queue.sync { listeners }
        for (_, fn) in snapshot { fn(payload) }
    }

    func emitProgress(receivedBytes: Int64, totalBytes: Int64?) {
        var payload: Payload = ["kind": "progress", "receivedBytes": receivedBytes]
        if let total = totalBytes, total >= 0 { payload["totalBytes"] = total }
        emit(payload)
    }

    func emitForeground() {
        emit(["kind": "foreground"])
    }
}

/// Streaming SHA-256 helpers (CryptoKit).
enum Sha256 {
    static func fileHex(_ url: URL) -> String? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        var hasher = SHA256()
        while true {
            let chunk = handle.readData(ofLength: 64 * 1024)
            if chunk.isEmpty { break }
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}
