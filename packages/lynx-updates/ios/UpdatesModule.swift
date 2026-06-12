import Foundation
import Lynx

/// JS bridge for OTA updates.
/// JS usage: NativeModules.Updates.downloadUpdate({...}, callback)
class UpdatesModule: NSObject, LynxModule {

    @objc static var name: String { "Updates" }

    @objc static var methodLookup: [String: String] {
        [
            "getInstalledRuntimeVersion": NSStringFromSelector(#selector(getInstalledRuntimeVersion)),
            "getPlatform": NSStringFromSelector(#selector(getPlatform)),
            "getCurrentUpdate": NSStringFromSelector(#selector(getCurrentUpdate(_:))),
            "getState": NSStringFromSelector(#selector(getState(_:))),
            "downloadUpdate": NSStringFromSelector(#selector(downloadUpdate(_:callback:))),
            "applyOnNextLaunch": NSStringFromSelector(#selector(applyOnNextLaunch(_:callback:))),
            "applyNow": NSStringFromSelector(#selector(applyNow(_:callback:))),
            "markReady": NSStringFromSelector(#selector(markReady(_:))),
            "setRollbackOptions": NSStringFromSelector(#selector(setRollbackOptions(_:callback:))),
            "clearUpdates": NSStringFromSelector(#selector(clearUpdates(_:))),
        ]
    }

    private static let downloadQueue = DispatchQueue(label: "com.sigx.updates.download")

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    private func errorMap(_ message: String, code: String? = nil) -> [String: Any] {
        var map: [String: Any] = ["error": message]
        if let code { map["code"] = code }
        return map
    }

    @objc func getInstalledRuntimeVersion() -> String {
        UpdateStore.shared.installedRuntimeVersion()
    }

    @objc func getPlatform() -> String { "ios" }

    @objc func getCurrentUpdate(_ callback: LynxCallbackBlock?) {
        let store = UpdateStore.shared
        var map: [String: Any] = [
            "runtimeVersion": store.installedRuntimeVersion(),
            // Store-shipped app version — providers receive it as
            // UpdateCheckContext.embeddedVersion.
            "embeddedVersion": (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "",
            "isFirstLaunchAfterUpdate": store.isFirstLaunchAfterUpdate,
            "didRollBack": store.didRollBack,
        ]
        if let updateId = store.launchedUpdateId {
            map["updateId"] = updateId
            map["isEmbedded"] = false
            if let data = try? Data(contentsOf: store.updateJsonFile(updateId)),
               let meta = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
               let version = meta["version"] as? String {
                map["version"] = version
            }
        } else {
            map["isEmbedded"] = true
        }
        if let rolledBack = store.rolledBackUpdateId {
            map["rolledBackUpdateId"] = rolledBack
        }
        callback?(map)
    }

    @objc func getState(_ callback: LynxCallbackBlock?) {
        let store = UpdateStore.shared
        var map: [String: Any] = ["runningUpdateId": store.launchedUpdateId ?? ""]
        if let state = store.readState() {
            map["currentUpdateId"] = state.currentUpdateId ?? ""
            map["previousUpdateId"] = state.previousUpdateId ?? ""
            map["pendingUpdateId"] = state.pendingUpdateId ?? ""
            map["pendingLaunchAttempts"] = state.pendingLaunchAttempts
            map["maxLaunchAttempts"] = state.maxLaunchAttempts
            map["lastRollbackUpdateId"] = state.lastRollbackUpdateId ?? ""
            map["lastRollbackReason"] = state.lastRollbackReason ?? ""
        }
        callback?(map)
    }

    @objc func downloadUpdate(_ params: [String: Any]?, callback: LynxCallbackBlock?) {
        guard let url = params?["url"] as? String, !url.isEmpty,
              let sha256 = params?["sha256"] as? String, !sha256.isEmpty,
              let updateId = params?["updateId"] as? String, !updateId.isEmpty else {
            callback?(errorMap("url, sha256 and updateId are required"))
            return
        }

        // Refuse incompatible bundles at the door — defense in depth on top
        // of the JS-side check.
        let installed = UpdateStore.shared.installedRuntimeVersion()
        if let runtimeVersion = params?["runtimeVersion"] as? String,
           !runtimeVersion.isEmpty, runtimeVersion != installed {
            callback?(errorMap(
                "Update requires runtime \(runtimeVersion) but binary is \(installed)",
                code: "E_RUNTIME_MISMATCH"))
            return
        }

        let headers = (params?["headers"] as? [String: String]) ?? [:]
        let manifestJson = (params?["manifestJson"] as? String) ?? "{}"

        Self.downloadQueue.async {
            let result = UpdateDownloader.download(
                url: url, expectedSha256: sha256, updateId: updateId,
                headers: headers, manifestJson: manifestJson)
            if let result {
                let code: String? = result.hasPrefix("E_DOWNLOAD_IN_PROGRESS") ? "E_DOWNLOAD_IN_PROGRESS"
                    : result.hasPrefix("E_HASH_MISMATCH") ? "hash-mismatch"
                    : nil
                callback?(self.errorMap(result, code: code))
            } else {
                callback?(["ok": true])
            }
        }
    }

    @objc func applyOnNextLaunch(_ updateId: String?, callback: LynxCallbackBlock?) {
        guard let updateId, !updateId.isEmpty else {
            callback?(errorMap("updateId is required"))
            return
        }
        if let failure = UpdateStore.shared.stagePending(updateId) {
            callback?(errorMap(failure))
        } else {
            callback?(["ok": true])
        }
    }

    @objc func applyNow(_ updateId: String?, callback: LynxCallbackBlock?) {
        guard let updateId, !updateId.isEmpty else {
            callback?(errorMap("updateId is required"))
            return
        }
        let store = UpdateStore.shared
        let bundle = store.bundleFile(updateId)
        guard FileManager.default.fileExists(atPath: bundle.path) else {
            callback?(errorMap("Update \(updateId) is not on disk"))
            return
        }
        guard let view = store.currentView() else {
            callback?(errorMap("No LynxView attached — cannot reload in place", code: "E_NO_VIEW"))
            return
        }
        // Stage first so a crash mid-reload still gets crash-guarded rollback
        // (the reload bypasses the startup resolver).
        _ = store.stagePending(updateId)
        store.recordReloadAttempt(updateId)
        DispatchQueue.main.async {
            guard let data = try? Data(contentsOf: bundle) else {
                callback?(self.errorMap("Could not read \(bundle.path)", code: "apply-failed"))
                return
            }
            view.loadTemplate(data, withURL: bundle.path)
            // JS context is replaced — the callback never reaches the old
            // context on success, which is the documented contract.
        }
    }

    @objc func markReady(_ callback: LynxCallbackBlock?) {
        UpdateStore.shared.markReady()
        callback?(["ok": true])
    }

    @objc func setRollbackOptions(_ params: [String: Any]?, callback: LynxCallbackBlock?) {
        let max = (params?["maxFailedLaunches"] as? Int) ?? 2
        UpdateStore.shared.setMaxLaunchAttempts(max)
        callback?(["ok": true])
    }

    @objc func clearUpdates(_ callback: LynxCallbackBlock?) {
        UpdateStore.shared.clearAll()
        callback?(["ok": true])
    }
}
