import Foundation
import UIKit

/// AppDelegate hook for `@sigx/lynx-linking`.
///
/// Discovered by the auto-linker via `signalx-module.json`'s
/// `ios.appDelegateHook` field; the generated `GeneratedAppDelegateHooks`
/// (in the app's source root) calls these static methods at the matching
/// `UIApplicationDelegate` callbacks.
///
/// What this hook does:
///   - **didFinishLaunching** — picks up a cold-start deep link from
///     `launchOptions[.url]` and forwards it into `LinkingState`.
///   - **openURL** — forwards warm-start custom-scheme deep links
///     (`myapp://...`).
///   - **continueUserActivity** — forwards Universal Links
///     (`https://your.domain/...`) when associated domains are configured.
@objc public class LinkingAppDelegateHook: NSObject {

    @objc public static func didFinishLaunching(
        _ application: UIApplication,
        launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) {
        if let url = launchOptions?[.url] as? URL {
            LinkingState.handleOpenURL(url)
        }
    }

    @objc public static func openURL(
        _ url: URL,
        options: [UIApplication.OpenURLOptionsKey: Any]
    ) -> Bool {
        LinkingState.handleOpenURL(url)
        return true
    }

    @objc public static func continueUserActivity(_ userActivity: NSUserActivity) {
        guard userActivity.activityType == NSUserActivityTypeBrowsingWeb,
              let url = userActivity.webpageURL else { return }
        LinkingState.handleOpenURL(url)
    }
}
