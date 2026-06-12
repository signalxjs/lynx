import Foundation
import Lynx

/// On-disk update store + state machine shared by `UpdatesBundleResolver`
/// (startup, before any LynxView exists) and `UpdatesModule` (JS bridge).
/// Mirror of the Android `UpdateStore` — see that file for the lifecycle
/// description; the layouts and state.json schema are identical.
final class UpdateStore {

    static let shared = UpdateStore()
    private init() {}

    private let lock = NSRecursiveLock()
    static let runtimeVersionPlistKey = "SigxRuntimeVersion"

    /// What this process actually loaded (set by the resolver).
    private(set) var launchedUpdateId: String?
    /// True when this launch is a pending update's trial run.
    private(set) var isFirstLaunchAfterUpdate = false
    /// True when the resolver rolled back at this startup.
    private(set) var didRollBack = false
    private(set) var rolledBackUpdateId: String?

    /// Last-attached LynxView — apply-now reload target.
    private weak var lynxView: LynxView?

    func attachView(_ view: LynxView) {
        lock.lock(); defer { lock.unlock() }
        lynxView = view
    }

    func currentView() -> LynxView? {
        lock.lock(); defer { lock.unlock() }
        return lynxView
    }

    // MARK: - Paths

    var rootDir: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("sigx-updates", isDirectory: true)
    }
    var updatesDir: URL { rootDir.appendingPathComponent("updates", isDirectory: true) }
    var tmpDir: URL { rootDir.appendingPathComponent("tmp", isDirectory: true) }
    func updateDir(_ updateId: String) -> URL { updatesDir.appendingPathComponent(updateId, isDirectory: true) }
    func bundleFile(_ updateId: String) -> URL { updateDir(updateId).appendingPathComponent("main.lynx.bundle") }
    func updateJsonFile(_ updateId: String) -> URL { updateDir(updateId).appendingPathComponent("update.json") }
    private var stateFile: URL { rootDir.appendingPathComponent("state.json") }

    /// OTA payloads are re-downloadable — exclude from iCloud/iTunes backup.
    private func excludeFromBackup(_ url: URL) {
        var u = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? u.setResourceValues(values)
    }

    // MARK: - Binary identity

    func installedRuntimeVersion() -> String {
        (Bundle.main.object(forInfoDictionaryKey: Self.runtimeVersionPlistKey) as? String) ?? "unknown"
    }

    func installedBinaryVersion() -> String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String) ?? "unknown"
    }

    // MARK: - State

    struct State {
        var installedRuntimeVersion = ""
        var installedBinaryVersion = ""
        var currentUpdateId: String?
        var previousUpdateId: String?
        var pendingUpdateId: String?
        var pendingLaunchAttempts = 0
        var maxLaunchAttempts = 2
        var lastRollbackUpdateId: String?
        var lastRollbackReason: String?
    }

    func readState() -> State? {
        lock.lock(); defer { lock.unlock() }
        guard let data = try? Data(contentsOf: stateFile),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            return nil
        }
        func str(_ key: String) -> String? {
            let v = json[key] as? String
            return (v?.isEmpty ?? true) ? nil : v
        }
        var state = State()
        state.installedRuntimeVersion = (json["installedRuntimeVersion"] as? String) ?? ""
        state.installedBinaryVersion = (json["installedBinaryVersion"] as? String) ?? ""
        state.currentUpdateId = str("currentUpdateId")
        state.previousUpdateId = str("previousUpdateId")
        state.pendingUpdateId = str("pendingUpdateId")
        state.pendingLaunchAttempts = (json["pendingLaunchAttempts"] as? Int) ?? 0
        state.maxLaunchAttempts = (json["maxLaunchAttempts"] as? Int) ?? 2
        state.lastRollbackUpdateId = str("lastRollbackUpdateId")
        state.lastRollbackReason = str("lastRollbackReason")
        return state
    }

    /// Atomic write — the launch-attempt counter must survive a crash.
    func writeState(_ state: State) {
        lock.lock(); defer { lock.unlock() }
        let json: [String: Any] = [
            "schemaVersion": 1,
            "installedRuntimeVersion": state.installedRuntimeVersion,
            "installedBinaryVersion": state.installedBinaryVersion,
            "currentUpdateId": state.currentUpdateId ?? "",
            "previousUpdateId": state.previousUpdateId ?? "",
            "pendingUpdateId": state.pendingUpdateId ?? "",
            "pendingLaunchAttempts": state.pendingLaunchAttempts,
            "maxLaunchAttempts": state.maxLaunchAttempts,
            "lastRollbackUpdateId": state.lastRollbackUpdateId ?? "",
            "lastRollbackReason": state.lastRollbackReason ?? "",
        ]
        try? FileManager.default.createDirectory(at: rootDir, withIntermediateDirectories: true)
        excludeFromBackup(rootDir)
        if let data = try? JSONSerialization.data(withJSONObject: json) {
            try? data.write(to: stateFile, options: .atomic)
        }
    }

    func freshState() -> State {
        var state = State()
        state.installedRuntimeVersion = installedRuntimeVersion()
        state.installedBinaryVersion = installedBinaryVersion()
        return state
    }

    // MARK: - Startup resolution

    /// Decide which bundle this launch loads. Returns an absolute path to an
    /// OTA bundle, or nil to use the baked resource. Mutates rollback state —
    /// the generated host calls it exactly once per process launch.
    func resolveStartupBundlePath() -> String? {
        lock.lock(); defer { lock.unlock() }
        let fm = FileManager.default
        try? fm.removeItem(at: tmpDir)

        guard var state = readState() else {
            if fm.fileExists(atPath: stateFile.path) {
                // Unparseable state — wipe everything, run baked.
                try? fm.removeItem(at: rootDir)
            }
            return nil
        }

        // Binary-update tripwire: a store update invalidates every
        // downloaded update — they were published for the old runtime.
        let runtimeNow = installedRuntimeVersion()
        let binaryNow = installedBinaryVersion()
        if state.installedRuntimeVersion != runtimeNow || state.installedBinaryVersion != binaryNow {
            try? fm.removeItem(at: updatesDir)
            writeState(freshState())
            return nil
        }

        // Pending update: crash-guarded trial launch.
        if let pending = state.pendingUpdateId {
            if state.pendingLaunchAttempts >= state.maxLaunchAttempts {
                rollbackPending(&state, reason: "crash")
            } else {
                let bundle = bundleFile(pending)
                let firstAttempt = state.pendingLaunchAttempts == 0
                let intact = fm.fileExists(atPath: bundle.path) && (!firstAttempt || verifySha256(pending))
                if intact {
                    state.pendingLaunchAttempts += 1
                    writeState(state)
                    launchedUpdateId = pending
                    isFirstLaunchAfterUpdate = firstAttempt
                    sweepOrphans(state)
                    return bundle.path
                }
                rollbackPending(&state, reason: "corrupt")
            }
        }

        // Committed update: trusted (existence check only).
        if let current = state.currentUpdateId {
            let bundle = bundleFile(current)
            if fm.fileExists(atPath: bundle.path) {
                launchedUpdateId = current
                sweepOrphans(state)
                return bundle.path
            }
            state.currentUpdateId = nil
            writeState(state)
        }

        sweepOrphans(state)
        return nil
    }

    private func rollbackPending(_ state: inout State, reason: String) {
        guard let pending = state.pendingUpdateId else { return }
        didRollBack = true
        rolledBackUpdateId = pending
        try? FileManager.default.removeItem(at: updateDir(pending))
        state.lastRollbackUpdateId = pending
        state.lastRollbackReason = reason
        state.pendingUpdateId = nil
        state.pendingLaunchAttempts = 0
        writeState(state)
    }

    private func sweepOrphans(_ state: State) {
        let keep = Set([state.currentUpdateId, state.previousUpdateId, state.pendingUpdateId].compactMap { $0 })
        let entries = (try? FileManager.default.contentsOfDirectory(at: updatesDir, includingPropertiesForKeys: nil)) ?? []
        for entry in entries where !keep.contains(entry.lastPathComponent) {
            try? FileManager.default.removeItem(at: entry)
        }
    }

    // MARK: - Transitions

    /// Stage a downloaded update to load on the next launch. Returns an error message or nil.
    func stagePending(_ updateId: String) -> String? {
        lock.lock(); defer { lock.unlock() }
        guard FileManager.default.fileExists(atPath: bundleFile(updateId).path) else {
            return "Update \(updateId) is not on disk"
        }
        var state = readState() ?? freshState()
        if state.currentUpdateId == updateId { return nil }
        state.pendingUpdateId = updateId
        state.pendingLaunchAttempts = 0
        writeState(state)
        return nil
    }

    /// Arm the crash guard for an in-place reload (which bypasses the resolver).
    func recordReloadAttempt(_ updateId: String) {
        lock.lock(); defer { lock.unlock() }
        var state = readState() ?? freshState()
        if state.pendingUpdateId != updateId {
            state.pendingUpdateId = updateId
        }
        state.pendingLaunchAttempts += 1
        writeState(state)
        launchedUpdateId = updateId
        isFirstLaunchAfterUpdate = true
    }

    /// Commit the running pending update as healthy. Idempotent.
    func markReady() {
        lock.lock(); defer { lock.unlock() }
        guard var state = readState(), let pending = state.pendingUpdateId else { return }
        guard launchedUpdateId == pending else { return }
        if let previous = state.previousUpdateId {
            try? FileManager.default.removeItem(at: updateDir(previous))
        }
        state.previousUpdateId = state.currentUpdateId
        state.currentUpdateId = pending
        state.pendingUpdateId = nil
        state.pendingLaunchAttempts = 0
        writeState(state)
    }

    func setMaxLaunchAttempts(_ max: Int) {
        lock.lock(); defer { lock.unlock() }
        var state = readState() ?? freshState()
        state.maxLaunchAttempts = Swift.min(Swift.max(max, 1), 10)
        writeState(state)
    }

    func clearAll() {
        lock.lock(); defer { lock.unlock() }
        try? FileManager.default.removeItem(at: updatesDir)
        try? FileManager.default.removeItem(at: tmpDir)
        writeState(freshState())
    }

    // MARK: - Helpers

    func verifySha256(_ updateId: String) -> Bool {
        guard let data = try? Data(contentsOf: updateJsonFile(updateId)),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let expected = (json["sha256"] as? String)?.lowercased(), !expected.isEmpty else {
            return false
        }
        return Sha256.fileHex(bundleFile(updateId)) == expected
    }
}
