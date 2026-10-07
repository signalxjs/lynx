import UIKit
import Lynx
import Security

/// Device information module, hosted by core's own native module.
/// JS usage: NativeModules.SigxCore.getDeviceInfo(callback)
class DeviceInfoModule: NSObject, LynxModule {

    @objc static var name: String { "SigxCore" }

    @objc static var methodLookup: [String: String] {
        [
            "getDeviceInfo": NSStringFromSelector(#selector(getDeviceInfo(_:))),
            "getAppState": NSStringFromSelector(#selector(getAppState(_:))),
            "lockOrientation": NSStringFromSelector(#selector(lockOrientation(_:callback:))),
            "unlockOrientation": NSStringFromSelector(#selector(unlockOrientation(_:))),
            "getRandomBytes": NSStringFromSelector(#selector(getRandomBytes(_:))),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    @objc func getDeviceInfo(_ callback: LynxCallbackBlock?) {
        let device = UIDevice.current
        let screen = UIScreen.main
        let bundle = Bundle.main

        let info: [String: Any] = [
            "platform": "ios",
            "brand": "Apple",
            "model": device.model,
            "modelName": modelIdentifier(),
            "manufacturer": "Apple",
            "systemName": device.systemName,
            "systemVersion": device.systemVersion,
            "deviceId": device.identifierForVendor?.uuidString ?? "unknown",
            "appVersion": bundle.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown",
            "appBuildNumber": bundle.infoDictionary?["CFBundleVersion"] as? String ?? "unknown",
            "bundleId": bundle.bundleIdentifier ?? "unknown",
            "screenWidth": Int(screen.bounds.width),
            "screenHeight": Int(screen.bounds.height),
            "screenScale": screen.scale,
        ]
        callback?(info)
    }

    /// Current app foreground/background state — seeds the JS default on the
    /// rare background boot. Live transitions arrive via `AppStatePublisher`'s
    /// `appStateChanged` global event.
    /// JS usage: NativeModules.SigxCore.getAppState(callback)  // { state }
    @objc func getAppState(_ callback: LynxCallbackBlock?) {
        DispatchQueue.main.async {
            let state = UIApplication.shared.applicationState == .background
                ? "background"
                : "active"
            callback?(["state": state])
        }
    }

    /// Runtime orientation lock (#856). The configured `orientation` (stamped
    /// into the AppDelegate's `supportedInterfaceOrientationsFor`) is the
    /// ceiling — see `SigxOrientation`.
    /// JS usage: NativeModules.SigxCore.lockOrientation({ orientation }, cb)
    @objc func lockOrientation(_ params: [String: Any]?, callback: LynxCallbackBlock?) {
        guard let value = params?["orientation"] as? String, !value.isEmpty else {
            callback?(["error": "Missing `orientation`."])
            return
        }
        callback?(result(SigxOrientation.lock(value)))
    }

    /// Release the runtime lock, restoring the configured set.
    @objc func unlockOrientation(_ callback: LynxCallbackBlock?) {
        callback?(result(SigxOrientation.unlock()))
    }

    /// Cryptographically secure random bytes (#1337), base64-encoded — the
    /// CSPRNG the BG thread lacks (no `crypto.getRandomValues`). Sync, so JS
    /// helpers like `generateState()` stay synchronous. Returns `""` for a
    /// length outside 1…1024 or a `SecRandomCopyBytes` failure; JS treats an
    /// empty or short result as "no random source" — never a weak fallback.
    /// JS usage: NativeModules.SigxCore.getRandomBytes(32)  // base64 string
    @objc func getRandomBytes(_ length: NSNumber) -> String {
        let n = length.intValue
        guard length.doubleValue == Double(n), n >= 1, n <= 1024 else { return "" }
        var bytes = [UInt8](repeating: 0, count: n)
        guard SecRandomCopyBytes(kSecRandomDefault, n, &bytes) == errSecSuccess else { return "" }
        return Data(bytes).base64EncodedString()
    }

    /// Empty map on success; `{ error }` on failure (CONVENTIONS.md C4).
    private func result(_ error: String?) -> [String: Any] {
        error.map { ["error": $0] } ?? [:]
    }

    private func modelIdentifier() -> String {
        var systemInfo = utsname()
        uname(&systemInfo)
        let mirror = Mirror(reflecting: systemInfo.machine)
        return mirror.children.reduce("") { identifier, element in
            guard let value = element.value as? Int8, value != 0 else { return identifier }
            return identifier + String(UnicodeScalar(UInt8(value)))
        }
    }
}
