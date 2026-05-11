import Foundation
import UIKit
import Lynx

/// Outbound deep-link bridge — JS calls these to open URLs in the system
/// handler. Inbound URLs (deep links *into* the app) are forwarded by the
/// host AppDelegate to `LinkingState.handleOpenURL(_:)`, which a paired
/// per-LynxView `LinkingPublisher` then forwards to JS via
/// `sendGlobalEvent("urlReceived", ...)` and `updateGlobalProps`.
///
/// JS usage:
///   NativeModules.Linking.openURL(urlString, callback)
///   NativeModules.Linking.canOpenURL(urlString, callback)
class LinkingModule: NSObject, LynxModule {

    @objc static var name: String { "Linking" }

    @objc static var methodLookup: [String: String] {
        [
            "openURL":    NSStringFromSelector(#selector(openURL(_:callback:))),
            "canOpenURL": NSStringFromSelector(#selector(canOpenURL(_:callback:))),
            "exitApp":    NSStringFromSelector(#selector(exitApp(_:))),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    @objc func openURL(_ url: String?, callback: LynxCallbackBlock?) {
        guard let urlString = url, let parsed = URL(string: urlString) else {
            callback?(["error": "Invalid URL"])
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(parsed, options: [:]) { success in
                if success {
                    callback?(NSNull())
                } else {
                    callback?(["error": "Failed to open URL"])
                }
            }
        }
    }

    @objc func canOpenURL(_ url: String?, callback: LynxCallbackBlock?) {
        guard let urlString = url, let parsed = URL(string: urlString) else {
            callback?(false)
            return
        }
        callback?(UIApplication.shared.canOpenURL(parsed))
    }

    /// iOS no-op — Apple's HIG forbids programmatic app termination, and
    /// `exit(0)` is rejected by App Review. We surface this as a callback
    /// resolution rather than an error so JS code that calls `exitApp()`
    /// uniformly across platforms doesn't have to branch.
    @objc func exitApp(_ callback: LynxCallbackBlock?) {
        callback?(["error": "exitApp is not supported on iOS"])
    }
}
