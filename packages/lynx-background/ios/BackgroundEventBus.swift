import Foundation

/// Process-wide pub/sub bus that converts BGTaskScheduler fire callbacks into
/// JS-side event payloads, and routes JS completions back to the in-flight
/// `BGTask` so the OS can hear `setTaskCompleted(success:)`.
///
/// Mirrors `PushEventBus` in `@sigx/lynx-notifications`. Owned process-wide,
/// independent of any LynxView lifecycle — BGTasks can fire before a LynxView
/// exists, and the bus replays nothing (each fire is a new OS event with its
/// own deadline; replaying a stale runId would race the OS expiration).
///
/// Wire shape on the `__sigxBackgroundFire` channel:
///     { "taskName": String, "runId": String }
final class BackgroundEventBus {

    static let shared = BackgroundEventBus()

    typealias Payload = [String: Any]
    typealias Listener = (String, Payload) -> Void

    private let queue = DispatchQueue(label: "com.sigx.background.bus")
    private var listeners: [(token: UUID, fn: Listener)] = []

    /// In-flight BGTasks, keyed by the `runId` we hand to JS. When JS calls
    /// `Background.completeTask(runId, success)` we look up the BGTask here
    /// and call `setTaskCompleted(success:)` on it. Stored as `Any` because
    /// `BGTask` is only available on iOS 13+ and this file builds against
    /// older deployment targets too — the cast site checks availability.
    private var inflight: [String: Any] = [:]

    // MARK: - Listener management

    @discardableResult
    func addListener(_ fn: @escaping Listener) -> UUID {
        let token = UUID()
        queue.sync { listeners.append((token, fn)) }
        return token
    }

    func removeListener(_ token: UUID) {
        queue.sync { listeners.removeAll { $0.token == token } }
    }

    // MARK: - Fire / complete

    /// Called by `BackgroundScheduler` from inside the BGTaskScheduler launch
    /// handler. Records the task under a fresh `runId`, publishes the fire
    /// event to JS, and returns the `runId` so the caller can wire the OS
    /// expiration handler to fail the same `runId`.
    func publishFire(taskName: String, task: Any) -> String {
        let runId = UUID().uuidString
        queue.sync { inflight[runId] = task }
        emit(
            channel: BackgroundEventChannel.fire,
            payload: ["taskName": taskName, "runId": runId],
        )
        return runId
    }

    /// Drain and return the in-flight task for a `runId`. Returns nil if the
    /// `runId` has already been completed (double-completion is harmless —
    /// JS may race the OS expiration handler).
    func takeInflight(runId: String) -> Any? {
        return queue.sync {
            let v = inflight[runId]
            inflight[runId] = nil
            return v
        }
    }

    private func emit(channel: String, payload: Payload) {
        let snapshot = queue.sync { listeners }
        for (_, fn) in snapshot { fn(channel, payload) }
    }
}

/// Stable event-channel names. JS shim mirrors these in `src/events.ts` —
/// keep in sync.
enum BackgroundEventChannel {
    static let fire = "__sigxBackgroundFire"
}
