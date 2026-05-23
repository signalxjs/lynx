import Foundation
import UIKit
#if canImport(BackgroundTasks)
import BackgroundTasks
#endif

/// AppDelegate hook for background tasks.
///
/// Apple's `BGTaskScheduler.register(forTaskWithIdentifier:)` MUST be called
/// before the app finishes launching — calling it later crashes with a
/// "Required identifier not registered" exception when the OS tries to fire
/// the task. The auto-linker wires this hook into the generated AppDelegate
/// dispatcher so it runs synchronously from
/// `application(_:didFinishLaunchingWithOptions:)`.
@objc public class BackgroundAppDelegateHook: NSObject {

    @objc public static func didFinishLaunching(
        _ application: UIApplication,
        launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) {
        if #available(iOS 13.0, *) {
            BackgroundScheduler.shared.registerAllPersistedTasks()
        }
    }
}
