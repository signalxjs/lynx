import UIKit
import Lynx

/// Device information module.
/// JS usage: NativeModules.DeviceInfo.getDeviceInfo(callback)
class DeviceInfoModule: NSObject, LynxModule {

    @objc static var name: String { "DeviceInfo" }

    @objc static var methodLookup: [String: String] {
        [
            "getDeviceInfo": NSStringFromSelector(#selector(getDeviceInfo(_:))),
            "getConstants": NSStringFromSelector(#selector(getConstants(_:))),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    @objc func getDeviceInfo(_ callback: LynxCallbackBlock?) {
        let device = UIDevice.current
        let screen = UIScreen.main
        let bundle = Bundle.main

        let info: [String: Any] = [
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

    @objc func getConstants(_ callback: LynxCallbackBlock?) {
        let constants: [String: Any] = [
            "platform": "ios",
            "runtime": "sigx-lynx-go",
            "lynxSdkVersion": "3.6.0",
        ]
        callback?(constants)
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
