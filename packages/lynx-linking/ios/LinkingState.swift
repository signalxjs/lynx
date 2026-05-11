import Foundation

/// Static façade between the host AppDelegate and the per-LynxView
/// `LinkingPublisher` instances. The host calls `handleOpenURL(_:)` from its
/// `application(_:open:options:)` and universal-link continuation paths;
/// publishers attached *before* the URL arrived receive it via the posted
/// notification, while publishers attached *after* read `latestURL` during
/// their init so cold-start links still seed `__globalProps.initialURL`.
///
/// `@objc` so the AppDelegate template can find the class via
/// `NSClassFromString("LinkingState")` without compile-time dependency on
/// this package — apps that don't pull in `@sigx/lynx-linking` keep
/// compiling.
@objc public class LinkingState: NSObject {

    /// Posted by `handleOpenURL(_:)`. Active publishers observe this and
    /// forward the URL to their `LynxView`. `userInfo["url"]` is a String.
    public static let didReceiveURL = Notification.Name("SigxLynxLinkingDidReceiveURL")

    /// Most recent URL the host forwarded. Read by `LinkingPublisher.init`
    /// so a publisher attached after a cold-start deep link still sees the
    /// URL on first paint.
    public private(set) static var latestURL: String?

    private static let queue = DispatchQueue(label: "com.sigx.linking.state")

    /// Forward an incoming URL from the host AppDelegate. Safe to call from
    /// any thread; the notification dispatch hops to the main queue.
    @objc public static func handleOpenURL(_ url: URL) {
        let urlString = url.absoluteString
        queue.sync { latestURL = urlString }
        DispatchQueue.main.async {
            NotificationCenter.default.post(
                name: didReceiveURL,
                object: nil,
                userInfo: ["url": urlString]
            )
        }
    }
}
