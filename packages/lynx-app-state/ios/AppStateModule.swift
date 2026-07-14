import UIKit
import Lynx

/// Sync-seed getter for the current app state.
/// JS usage:
///   NativeModules.AppState.getAppState(callback)   // { state: 'active' | 'background' }
///
/// Live transitions are delivered by `AppStatePublisher` via the
/// `appStateChanged` global event; this method exists so the JS side can
/// correct its `'active'` default on the rare background boot (e.g. the app
/// launched by the OS while backgrounded).
class AppStateModule: NSObject, LynxModule {

    @objc static var name: String { "AppState" }

    @objc static var methodLookup: [String: String] {
        [
            "getAppState": NSStringFromSelector(#selector(getAppState(_:))),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    @objc func getAppState(_ callback: LynxCallbackBlock?) {
        // applicationState is main-thread-only.
        DispatchQueue.main.async {
            let state = UIApplication.shared.applicationState == .background
                ? "background"
                : "active"
            callback?(["state": state])
        }
    }
}
