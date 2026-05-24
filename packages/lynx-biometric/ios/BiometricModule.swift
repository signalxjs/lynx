import Foundation
import Lynx
import LocalAuthentication

/// Biometric authentication module — Face ID / Touch ID / Optic ID via
/// `LAContext`.
///
/// JS usage: `NativeModules.Biometric.<method>(...)`.
///
/// `NSFaceIDUsageDescription` must be present in `Info.plist` on devices
/// with Face ID; `sigx prebuild` writes a default value from this package's
/// `signalx-module.json` — override via the app's `signalx.config.ts`.
class BiometricModule: NSObject, LynxModule {

    @objc static var name: String { "Biometric" }

    @objc static var methodLookup: [String: String] {
        [
            "isAvailable": NSStringFromSelector(#selector(isAvailable(_:))),
            "authenticate": NSStringFromSelector(#selector(authenticate(_:callback:))),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    @objc func isAvailable(_ callback: LynxCallbackBlock?) {
        let context = LAContext()
        var error: NSError?
        let canEvaluate = context.canEvaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics, error: &error,
        )
        callback?([
            "available": canEvaluate,
            "type": biometryTypeString(context.biometryType),
        ])
    }

    @objc func authenticate(_ options: [String: Any]?, callback: LynxCallbackBlock?) {
        let reason = (options?["reason"] as? String) ?? "Authenticate"
        let fallbackTitle = options?["fallbackTitle"] as? String
        let allowDeviceCredential = (options?["allowDeviceCredential"] as? Bool) ?? false

        let context = LAContext()
        if let fallback = fallbackTitle {
            // Apple treats empty string as "hide the fallback button" — keep
            // that semantic so callers can opt out explicitly.
            context.localizedFallbackTitle = fallback
        }

        let policy: LAPolicy = allowDeviceCredential
            ? .deviceOwnerAuthentication
            : .deviceOwnerAuthenticationWithBiometrics

        var canEvalError: NSError?
        guard context.canEvaluatePolicy(policy, error: &canEvalError) else {
            callback?(errorPayload(canEvalError))
            return
        }

        context.evaluatePolicy(policy, localizedReason: reason) { success, evalError in
            // LAContext invokes the callback on an arbitrary background queue.
            // Forward to main so JS callbacks observe a predictable thread.
            DispatchQueue.main.async {
                if success {
                    callback?(["success": true])
                } else {
                    callback?(self.errorPayload(evalError as NSError?))
                }
            }
        }
    }

    private func biometryTypeString(_ type: LABiometryType) -> String {
        switch type {
        case .faceID: return "faceId"
        case .touchID: return "touchId"
        default:
            if #available(iOS 17.0, *), type == .opticID {
                return "iris"
            }
            return "none"
        }
    }

    private func errorPayload(_ error: NSError?) -> [String: Any] {
        let (code, message) = mapLAError(error)
        return [
            "success": false,
            "error": message,
            "errorCode": code,
        ]
    }

    private func mapLAError(_ error: NSError?) -> (String, String) {
        guard let error = error else {
            return ("unknown", "Unknown error")
        }
        let message = error.localizedDescription
        guard error.domain == LAErrorDomain || error.domain == "com.apple.LocalAuthentication" else {
            return ("unknown", message)
        }
        switch error.code {
        case LAError.userCancel.rawValue: return ("userCancel", message)
        case LAError.userFallback.rawValue: return ("userFallback", message)
        case LAError.systemCancel.rawValue: return ("systemCancel", message)
        case LAError.authenticationFailed.rawValue: return ("authenticationFailed", message)
        case LAError.biometryNotAvailable.rawValue: return ("biometryNotAvailable", message)
        case LAError.biometryNotEnrolled.rawValue: return ("biometryNotEnrolled", message)
        case LAError.biometryLockout.rawValue: return ("biometryLockout", message)
        case LAError.passcodeNotSet.rawValue: return ("biometryNotAvailable", message)
        case LAError.appCancel.rawValue: return ("systemCancel", message)
        case LAError.invalidContext.rawValue: return ("unknown", message)
        case LAError.notInteractive.rawValue: return ("systemCancel", message)
        default: return ("unknown", message)
        }
    }
}
