import Foundation
#if canImport(BackgroundTasks)
import BackgroundTasks
#endif

/// `BGTaskScheduler` wrapper that owns:
///   - The list of task identifiers we've been asked to schedule (persisted in
///     UserDefaults so the next cold start can re-register them with the OS
///     BEFORE `application(_:didFinishLaunchingWithOptions:)` returns, as
///     Apple requires).
///   - The mapping from short JS-side `taskName` to the fully-qualified
///     reverse-DNS BGTask identifier (`${bundleId}.bg.${taskName}`).
///   - Submitting `BGAppRefreshTaskRequest` / `BGProcessingTaskRequest` for
///     each task, and re-submitting after every fire (the OS requires one
///     submission per fire — there's no built-in repeat).
///
/// `register(forTaskWithIdentifier:)` MUST be called before the app finishes
/// launching, so `BackgroundAppDelegateHook.didFinishLaunching` invokes
/// `registerAllPersistedTasks()` synchronously from there.
@available(iOS 13.0, *)
final class BackgroundScheduler {

    static let shared = BackgroundScheduler()

    private let defaultsKey = "com.sigx.background.tasks"
    private let queue = DispatchQueue(label: "com.sigx.background.scheduler")

    // MARK: - Identifier mapping

    /// Reverse-DNS-namespaced BGTask identifier. iOS requires every
    /// identifier in `BGTaskSchedulerPermittedIdentifiers` to be a real
    /// reverse-DNS string under the app's bundle — using the raw JS
    /// `taskName` would collide across apps installed on the same device.
    static func identifier(for taskName: String) -> String {
        let bundleId = Bundle.main.bundleIdentifier ?? "app"
        return "\(bundleId).bg.\(taskName)"
    }

    static func taskName(from identifier: String) -> String? {
        let bundleId = Bundle.main.bundleIdentifier ?? "app"
        let prefix = "\(bundleId).bg."
        guard identifier.hasPrefix(prefix) else { return nil }
        return String(identifier.dropFirst(prefix.count))
    }

    // MARK: - Persistence

    /// Persisted shape:
    ///   { taskName: { minimumInterval: Double?, requiresNetwork: Bool?,
    ///                 requiresCharging: Bool?, type: "fetch"|"processing" } }
    func loadPersisted() -> [String: [String: Any]] {
        return (UserDefaults.standard.dictionary(forKey: defaultsKey) as? [String: [String: Any]]) ?? [:]
    }

    private func savePersisted(_ tasks: [String: [String: Any]]) {
        UserDefaults.standard.set(tasks, forKey: defaultsKey)
    }

    func upsert(taskName: String, options: [String: Any]) {
        queue.sync {
            var tasks = loadPersisted()
            tasks[taskName] = options
            savePersisted(tasks)
        }
    }

    func remove(taskName: String) {
        queue.sync {
            var tasks = loadPersisted()
            tasks.removeValue(forKey: taskName)
            savePersisted(tasks)
        }
    }

    func registeredTaskNames() -> [String] {
        return Array(loadPersisted().keys)
    }

    // MARK: - BGTaskScheduler integration

    /// Called from `BackgroundAppDelegateHook.didFinishLaunching`. Registers
    /// a launch handler with `BGTaskScheduler` for every persisted task so
    /// the OS knows we can service them. MUST run before the app finishes
    /// launching — Apple's docs are explicit and crash on violation.
    func registerAllPersistedTasks() {
        #if canImport(BackgroundTasks)
        let scheduler = BGTaskScheduler.shared
        for (taskName, _) in loadPersisted() {
            let identifier = Self.identifier(for: taskName)
            scheduler.register(forTaskWithIdentifier: identifier, using: nil) { task in
                self.handleLaunch(task: task, taskName: taskName)
            }
        }
        // Also resubmit pending requests on every cold start so the OS
        // doesn't forget a previously-cancelled-by-reboot schedule.
        for (taskName, options) in loadPersisted() {
            try? submitRequest(taskName: taskName, options: options)
        }
        #endif
    }

    /// Submit a fresh `BGAppRefreshTaskRequest` or `BGProcessingTaskRequest`
    /// for the given task. Idempotent — the OS replaces an existing pending
    /// request with the same identifier rather than enqueueing a duplicate.
    func submitRequest(taskName: String, options: [String: Any]) throws {
        #if canImport(BackgroundTasks)
        let identifier = Self.identifier(for: taskName)
        let type = (options["type"] as? String) ?? "fetch"
        let earliest = (options["minimumInterval"] as? Double).map { Date(timeIntervalSinceNow: $0) }

        let request: BGTaskRequest
        if type == "processing" {
            let req = BGProcessingTaskRequest(identifier: identifier)
            req.requiresNetworkConnectivity = (options["requiresNetwork"] as? Bool) ?? false
            req.requiresExternalPower = (options["requiresCharging"] as? Bool) ?? false
            request = req
        } else {
            // BGAppRefreshTaskRequest has no constraint knobs — the OS picks
            // the moment based on its own heuristics. `requiresNetwork` /
            // `requiresCharging` are silently ignored for `'fetch'` tasks
            // because iOS doesn't expose those constraints on app refresh.
            // Apps that need them must use `type: 'processing'`.
            request = BGAppRefreshTaskRequest(identifier: identifier)
        }
        request.earliestBeginDate = earliest
        try BGTaskScheduler.shared.submit(request)
        #endif
    }

    func cancel(taskName: String) {
        #if canImport(BackgroundTasks)
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.identifier(for: taskName))
        #endif
    }

    // MARK: - Launch handling

    #if canImport(BackgroundTasks)
    /// Called by BGTaskScheduler when the OS wakes us for a registered task.
    /// Publishes a fire event to JS, wires the BGTask's expiration handler
    /// to a `success: false` completion, and immediately re-submits the
    /// next request so the task keeps repeating on iOS's own schedule.
    private func handleLaunch(task: BGTask, taskName: String) {
        // Resubmit immediately so the OS knows we still want to be woken.
        // If JS later calls `unregister`, we'll cancel the pending request.
        if let options = loadPersisted()[taskName] {
            try? submitRequest(taskName: taskName, options: options)
        }

        let runId = BackgroundEventBus.shared.publishFire(taskName: taskName, task: task)

        // Wire the OS expiration handler as a safety net. If JS doesn't call
        // `completeTask` within the platform budget, the OS will fire this
        // and we mark the task as failed so subsequent submissions aren't
        // throttled by a "never completed" record.
        task.expirationHandler = {
            if let inflight = BackgroundEventBus.shared.takeInflight(runId: runId) as? BGTask {
                inflight.setTaskCompleted(success: false)
            }
        }
    }
    #endif
}
