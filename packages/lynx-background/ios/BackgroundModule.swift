import Foundation
import Lynx
#if canImport(BackgroundTasks)
import BackgroundTasks
#endif

/// Periodic background tasks via `BGTaskScheduler`.
///
/// JS usage: `NativeModules.Background.<method>(...)`.
///
/// Permitted task identifiers must be declared in the app's Info.plist under
/// `BGTaskSchedulerPermittedIdentifiers`. `sigx prebuild` writes them based
/// on the app's `ios.bgTaskIdentifiers` config — manual edits are
/// unnecessary for CLI-managed projects.
class BackgroundModule: NSObject, LynxModule {

    @objc static var name: String { "Background" }

    @objc static var methodLookup: [String: String] {
        [
            "register": NSStringFromSelector(#selector(register(_:options:callback:))),
            "unregister": NSStringFromSelector(#selector(unregister(_:callback:))),
            "getRegistered": NSStringFromSelector(#selector(getRegistered(_:))),
            "completeTask": NSStringFromSelector(#selector(completeTask(_:success:callback:))),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    @objc func register(_ taskName: String?, options: [String: Any]?, callback: LynxCallbackBlock?) {
        guard let taskName = taskName, !taskName.isEmpty else {
            callback?(["error": "taskName is required"])
            return
        }
        guard #available(iOS 13.0, *) else {
            callback?(["error": "BGTaskScheduler requires iOS 13+"])
            return
        }
        let opts = options ?? [:]
        BackgroundScheduler.shared.upsert(taskName: taskName, options: opts)
        do {
            try BackgroundScheduler.shared.submitRequest(taskName: taskName, options: opts)
            callback?(["ok": true])
        } catch {
            // Submission can fail if the identifier isn't in
            // `BGTaskSchedulerPermittedIdentifiers`, or if the request is
            // malformed. Persistence is already done so a later prebuild
            // that fixes the plist will re-submit on cold start.
            callback?(["error": "BGTaskScheduler.submit failed: \(error.localizedDescription)"])
        }
    }

    @objc func unregister(_ taskName: String?, callback: LynxCallbackBlock?) {
        guard let taskName = taskName, !taskName.isEmpty else {
            callback?(["ok": false])
            return
        }
        if #available(iOS 13.0, *) {
            BackgroundScheduler.shared.cancel(taskName: taskName)
        }
        BackgroundScheduler.shared.remove(taskName: taskName)
        callback?(["ok": true])
    }

    @objc func getRegistered(_ callback: LynxCallbackBlock?) {
        callback?(BackgroundScheduler.shared.registeredTaskNames())
    }

    /// Called by JS once its handler resolves. We resolve the in-flight
    /// `BGTask` matching `runId` so the OS can post
    /// `setTaskCompleted(success:)`. Safe to call multiple times — the
    /// second call finds no in-flight entry and is silently dropped.
    @objc func completeTask(_ runId: String?, success: NSNumber?, callback: LynxCallbackBlock?) {
        guard #available(iOS 13.0, *) else {
            callback?(["ok": false])
            return
        }
        guard let runId = runId else {
            callback?(["ok": false])
            return
        }
        let ok = success?.boolValue ?? false
        if let task = BackgroundEventBus.shared.takeInflight(runId: runId) as? BGTask {
            task.setTaskCompleted(success: ok)
        }
        callback?(["ok": true])
    }
}

