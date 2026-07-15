import Foundation
import UIKit
import UserNotifications

/// AppDelegate hook for remote push.
///
/// Discovered by the auto-linker via `signalx-module.json`'s
/// `ios.appDelegateHook` field; the generated `GeneratedAppDelegateHooks` calls
/// these static methods at the matching `UIApplicationDelegate` callbacks.
///
/// Responsibilities:
///   - `didFinishLaunching` — install the singleton `UNUserNotificationCenter`
///     delegate so foreground banners and tap callbacks reach JS, and observe
///     first-activation so a launch tap can be told from an in-session one.
///     Cold-start payloads for `Notifications.getInitialNotification()` are
///     captured in `didReceive`, not from `launchOptions` — see the note there.
///   - `didRegisterForRemoteNotificationsWithDeviceToken` — converts the APNs
///     `Data` token to its canonical hex form and publishes via `PushEventBus`.
///   - `didFailToRegisterForRemoteNotificationsWithError` — surfaces the error
///     to JS so apps can show a "push unavailable" state instead of hanging.
@objc public class PushAppDelegateHook: NSObject {

    @objc public static func didFinishLaunching(
        _ application: UIApplication,
        launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) {
        // Take ownership of the notification-center delegate BEFORE this method
        // returns — Apple requires the delegate be set by then for `didReceive`
        // to be delivered for the tap that launched us, which is what makes it
        // the single source of truth below. Apps that need to interpose their
        // own delegate should set it AFTER our hook runs and forward to
        // PushNotificationDelegate.shared. (Standard pattern for Firebase /
        // OneSignal / etc.)
        UNUserNotificationCenter.current().delegate = PushNotificationDelegate.shared

        // Close the cold-start window the first time the app reaches .active.
        // Until then a tap is the tap that launched us and is stashed for
        // `getInitialNotification()`; after, it's an in-session tap and belongs
        // on the response channel. Never removed — process-lifetime singleton.
        NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { _ in
            if UNUserNotificationCenter.current().delegate !== PushNotificationDelegate.shared {
                NSLog("[lynx-notifications] UNUserNotificationCenter.delegate was replaced; "
                    + "notification taps will not reach JS unless the replacement forwards to "
                    + "PushNotificationDelegate.shared")
            }
            PushEventBus.shared.markBecameActive()
        }

        // NOTE: `launchOptions[.remoteNotification]` is deliberately NOT read.
        // iOS populates it for a `content-available` push that launches the app
        // into the BACKGROUND with no user interaction, so treating it as a tap
        // made `getInitialNotification()` hand back a payload the user never
        // tapped — a spurious deep-link on the next manual open. It also
        // double-handled genuine taps (captured here AND redelivered via
        // `didReceive`, which then published on the response channel because
        // the window was already closed). `didReceive` fires for every real tap
        // including cold start, carries the true `actionIdentifier`, and is now
        // the only tap path — the approach RN Firebase and Expo rely on (#619).
    }

    @objc public static func didRegisterForRemoteNotificationsWithDeviceToken(
        _ application: UIApplication,
        deviceToken: Data
    ) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        PushEventBus.shared.publishToken(hex, platform: "apns")
    }

    @objc public static func didFailToRegisterForRemoteNotificationsWithError(
        _ application: UIApplication,
        error: Error
    ) {
        PushEventBus.shared.publishTokenError(error.localizedDescription)
    }

    /// Pull a notification id and string-coerced data dict out of an APNs
    /// userInfo payload. Notification id falls back to a generated UUID when
    /// the payload doesn't carry one (APNs doesn't require it; some servers
    /// set it as `apns-collapse-id` or in a custom field).
    static func extractData(from userInfo: [AnyHashable: Any]) -> (String, [String: String]) {
        var data: [String: String] = [:]
        var notificationId = UUID().uuidString
        for (k, v) in userInfo {
            guard let key = k as? String else { continue }
            // `aps` carries title/body/sound — strip it from the JS-visible
            // data dict; the relevant fields are surfaced as title/body
            // already by the foreground / response handlers.
            if key == "aps" { continue }
            if key == "notification_id" || key == "notificationId" {
                if let s = v as? String { notificationId = s }
                continue
            }
            data[key] = jsonScalar(v)
        }
        return (notificationId, data)
    }

    /// Map Apple's action identifiers onto the module's cross-platform names.
    ///
    /// `UNNotificationResponse.actionIdentifier` is
    /// `"com.apple.UNNotificationDefaultActionIdentifier"` for a standard tap,
    /// where Android sends `"default"` — so an app routing on
    /// `actionIdentifier === 'default'` (which is what `NotificationResponse`
    /// documents) worked on Android and silently never matched on iOS. Normalise
    /// here rather than in the JS shim so the raw event channels carry the same
    /// contract as the typed API. Custom category actions pass through untouched
    /// — those names are the app's own.
    static func normalizedActionIdentifier(_ raw: String) -> String {
        switch raw {
        case UNNotificationDefaultActionIdentifier: return "default"
        case UNNotificationDismissActionIdentifier: return "dismiss"
        default: return raw
        }
    }

    /// Coerce an APNs custom value to a string.
    ///
    /// The JS wire type is `Record<string, string>` — FCM's `data` map is
    /// string-only, so strings are the cross-platform floor. But APNs custom
    /// keys are arbitrary JSON: a sender CAN put `{"route":{"id":42}}`
    /// alongside `aps`. Plain `"\(v)"` rendered that as Swift's *debug*
    /// description (`{ id = 42; }`) — unparseable, with nondeterministic key
    /// order — and rendered a JSON `true` as NSNumber's `"1"`. JSON-encode
    /// instead, so a nested value recovers via `JSON.parse(msg.data.route)` and
    /// booleans read as `"true"`.
    private static func jsonScalar(_ v: Any) -> String {
        // Don't round-trip plain strings — that would double-quote them.
        if let s = v as? String { return s }
        if let data = try? JSONSerialization.data(withJSONObject: v, options: [.fragmentsAllowed]),
           let s = String(data: data, encoding: .utf8) {
            return s
        }
        // Last resort for values JSONSerialization rejects (e.g. NSDate).
        return "\(v)"
    }
}

/// Singleton `UNUserNotificationCenterDelegate`. Forwards foreground deliveries
/// (`willPresent`) and tap responses (`didReceive`) to `PushEventBus`. Owned by
/// `PushAppDelegateHook.didFinishLaunching`; the app keeps it as
/// `UNUserNotificationCenter.current().delegate`.
final class PushNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {

    static let shared = PushNotificationDelegate()

    /// Foreground delivery. Pass `[.banner, .list, .sound, .badge]` so the OS
    /// shows the banner even when the app is open — without this, iOS suppresses
    /// foreground notifications entirely (the historical complaint in the
    /// previous local-only README).
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let content = notification.request.content
        let (_, data) = PushAppDelegateHook.extractData(from: content.userInfo)
        PushEventBus.shared.publishMessage(
            title: content.title.isEmpty ? nil : content.title,
            body: content.body.isEmpty ? nil : content.body,
            data: data,
            foreground: true
        )
        if #available(iOS 14.0, *) {
            completionHandler([.banner, .list, .sound, .badge])
        } else {
            completionHandler([.alert, .sound, .badge])
        }
    }

    /// User tapped a notification (remote OR local). This is the path the
    /// previous README flagged as "Tap callbacks aren't surfaced in JS yet" —
    /// now they are.
    ///
    /// This is the ONLY tap path — remote and local, cold and warm. If the app
    /// hasn't yet become active, this tap is what launched the process, so it's
    /// stashed as the initial payload (drained later by
    /// `getInitialNotification()`) instead of fired on the response channel.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let content = response.notification.request.content
        let (idFromPayload, data) = PushAppDelegateHook.extractData(from: content.userInfo)
        let actionIdentifier = PushAppDelegateHook
            .normalizedActionIdentifier(response.actionIdentifier)
        let notificationId = response.notification.request.identifier.isEmpty
            ? idFromPayload
            : response.notification.request.identifier
        let captured = PushEventBus.shared.captureInitialResponseIfColdStart(
            notificationId: notificationId,
            data: data,
            actionIdentifier: actionIdentifier
        )
        if !captured {
            PushEventBus.shared.publishResponse(
                notificationId: notificationId,
                data: data,
                actionIdentifier: actionIdentifier
            )
        }
        completionHandler()
    }
}
