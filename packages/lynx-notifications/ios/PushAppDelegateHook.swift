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
///     delegate so foreground banners and tap callbacks reach JS. Also captures
///     a cold-start notification payload (`launchOptions[.remoteNotification]`)
///     for `Notifications.getInitialNotification()`.
///   - `didRegisterForRemoteNotificationsWithDeviceToken` — converts the APNs
///     `Data` token to its canonical hex form and publishes via `PushEventBus`.
///   - `didFailToRegisterForRemoteNotificationsWithError` — surfaces the error
///     to JS so apps can show a "push unavailable" state instead of hanging.
@objc public class PushAppDelegateHook: NSObject {

    @objc public static func didFinishLaunching(
        _ application: UIApplication,
        launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) {
        // Take ownership of the notification-center delegate. Apps that need
        // to interpose their own delegate should set it AFTER our hook runs
        // and forward to PushNotificationDelegate.shared from their
        // implementation. (Standard pattern for Firebase / OneSignal / etc.)
        UNUserNotificationCenter.current().delegate = PushNotificationDelegate.shared

        // Open the cold-start capture window. The first `didReceive` tap
        // after launch (which is how local notifications launched from a
        // terminated state arrive — they never appear in launchOptions) will
        // be stashed as the initial payload instead of fired on the response
        // channel. JS drains it via `getInitialNotification()`.
        PushEventBus.shared.beginColdStartWindow()

        // Cold-start REMOTE push: iOS also pre-populates
        // `launchOptions[.remoteNotification]` for these. Capture the payload
        // here too — same destination, just a different source.
        if let userInfo = launchOptions?[.remoteNotification] as? [AnyHashable: Any] {
            let (payloadId, data) = extractData(from: userInfo)
            PushEventBus.shared.captureInitialResponse(
                notificationId: payloadId ?? UUID().uuidString,
                data: data,
                actionIdentifier: UNNotificationDefaultActionIdentifier
            )
        }
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
    /// userInfo payload. Notification id is nil when the payload doesn't
    /// carry one (APNs doesn't require it) — callers pick their own fallback.
    static func extractData(from userInfo: [AnyHashable: Any]) -> (String?, [String: String]) {
        var data: [String: String] = [:]
        var notificationId: String? = nil
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
            data[key] = "\(v)"
        }
        return (notificationId, data)
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
    /// If we're still in the cold-start window opened by
    /// `didFinishLaunching`, the first tap is stashed as the initial payload
    /// (drained later by `getInitialNotification()`) instead of fired on the
    /// response channel — this covers local notifications launched from a
    /// terminated state, where `launchOptions[.remoteNotification]` is empty.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let content = response.notification.request.content
        let (idFromPayload, data) = PushAppDelegateHook.extractData(from: content.userInfo)
        // Prefer the payload's data.notification_id — for remote pushes the
        // request identifier is system-assigned junk, and JS keys tap routing
        // and cancel(id) on the payload id. Local schedules carry no payload
        // id, so their request identifier (the UUID `schedule` returned) wins.
        let requestId = response.notification.request.identifier
        let notificationId = idFromPayload ?? (requestId.isEmpty ? UUID().uuidString : requestId)
        let captured = PushEventBus.shared.captureInitialResponseIfColdStart(
            notificationId: notificationId,
            data: data,
            actionIdentifier: response.actionIdentifier
        )
        if !captured {
            PushEventBus.shared.publishResponse(
                notificationId: notificationId,
                data: data,
                actionIdentifier: response.actionIdentifier
            )
        }
        completionHandler()
    }
}
