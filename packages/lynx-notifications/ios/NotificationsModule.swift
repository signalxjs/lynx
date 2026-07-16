import Foundation
import UIKit
import UserNotifications
import Lynx

/// Local + remote notifications module.
/// JS usage: NativeModules.Notifications.<method>(...)
class NotificationsModule: NSObject, LynxModule {

    @objc static var name: String { "Notifications" }

    @objc static var methodLookup: [String: String] {
        [
            "schedule": NSStringFromSelector(#selector(schedule(_:options:callback:))),
            "cancel": NSStringFromSelector(#selector(cancel(_:callback:))),
            "cancelAll": NSStringFromSelector(#selector(cancelAll(_:))),
            "requestPermission": NSStringFromSelector(#selector(requestPermission(_:))),
            "getPermissionStatus": NSStringFromSelector(#selector(getPermissionStatus(_:))),
            "registerForPushNotifications": NSStringFromSelector(#selector(registerForPushNotifications(_:))),
            "unregisterForPushNotifications": NSStringFromSelector(#selector(unregisterForPushNotifications(_:))),
            "setBadgeCount": NSStringFromSelector(#selector(setBadgeCount(_:callback:))),
            "getBadgeCount": NSStringFromSelector(#selector(getBadgeCount(_:))),
            "getInitialNotification": NSStringFromSelector(#selector(getInitialNotification(_:))),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    @objc func schedule(_ content: [String: Any]?, options: [String: Any]?, callback: LynxCallbackBlock?) {
        let title = content?["title"] as? String ?? "Notification"
        let body = content?["body"] as? String ?? ""
        let delay = options?["delay"] as? TimeInterval ?? 0
        let data = content?["data"] as? [String: String] ?? [:]

        let notificationId = UUID().uuidString

        let notificationContent = UNMutableNotificationContent()
        notificationContent.title = title
        notificationContent.body = body
        notificationContent.sound = .default
        // Round-trip the data dict so a local tap surfaces it on
        // didReceiveResponse → publishResponse — same wire shape as remote.
        notificationContent.userInfo = data

        let trigger: UNNotificationTrigger
        if delay > 0 {
            trigger = UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false)
        } else {
            trigger = UNTimeIntervalNotificationTrigger(timeInterval: 0.1, repeats: false)
        }

        let request = UNNotificationRequest(identifier: notificationId, content: notificationContent, trigger: trigger)

        UNUserNotificationCenter.current().add(request) { error in
            if let error = error {
                callback?(["error": error.localizedDescription])
            } else {
                callback?(notificationId)
            }
        }
    }

    @objc func cancel(_ notificationId: String?, callback: LynxCallbackBlock?) {
        guard let notificationId = notificationId else {
            callback?(false)
            return
        }
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [notificationId])
        // Delivered remote pushes carry a system-assigned request identifier;
        // the JS-visible id lives in the payload (data.notification_id — the
        // same contract Android keys the tray entry on). Match both so
        // cancel(id) reaches local schedules (identifier == id) and remote
        // pushes (payload id == id), including collapse-id senders. Payload
        // matching is remote-only: a local schedule whose data dict contains
        // notification_id stays keyed on its schedule UUID, as on Android.
        center.getDeliveredNotifications { delivered in
            var identifiers = [notificationId]
            for notification in delivered where notification.request.trigger is UNPushNotificationTrigger {
                let info = notification.request.content.userInfo
                let payloadId = (info["notification_id"] as? String) ?? (info["notificationId"] as? String)
                if payloadId == notificationId {
                    identifiers.append(notification.request.identifier)
                }
            }
            center.removeDeliveredNotifications(withIdentifiers: identifiers)
            callback?(true)
        }
    }

    @objc func cancelAll(_ callback: LynxCallbackBlock?) {
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        callback?(true)
    }

    @objc func requestPermission(_ callback: LynxCallbackBlock?) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error = error {
                callback?(["status": "denied", "error": error.localizedDescription])
            } else {
                callback?(["status": granted ? "granted" : "denied"])
            }
        }
    }

    @objc func getPermissionStatus(_ callback: LynxCallbackBlock?) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let status: String
            switch settings.authorizationStatus {
            case .notDetermined: status = "undetermined"
            case .denied:        status = "denied"
            case .authorized:    status = "granted"
            case .provisional:   status = "granted"
            case .ephemeral:     status = "granted"
            @unknown default:    status = "unknown"
            }
            callback?(["status": status])
        }
    }

    // MARK: - Remote push

    /// Ask iOS to contact APNs. The token (or registration failure) arrives
    /// asynchronously via the AppDelegate hook → `PushEventBus` → JS event.
    /// The callback only confirms that `registerForRemoteNotifications` was
    /// dispatched — it does NOT block on token receipt.
    @objc func registerForPushNotifications(_ callback: LynxCallbackBlock?) {
        DispatchQueue.main.async {
            UIApplication.shared.registerForRemoteNotifications()
            callback?(["dispatched": true])
        }
    }

    @objc func unregisterForPushNotifications(_ callback: LynxCallbackBlock?) {
        DispatchQueue.main.async {
            UIApplication.shared.unregisterForRemoteNotifications()
            callback?(["ok": true])
        }
    }

    @objc func setBadgeCount(_ count: NSNumber?, callback: LynxCallbackBlock?) {
        let value = count?.intValue ?? 0
        if #available(iOS 16.0, *) {
            UNUserNotificationCenter.current().setBadgeCount(value) { error in
                if let error = error {
                    callback?(["error": error.localizedDescription])
                } else {
                    callback?(true)
                }
            }
        } else {
            DispatchQueue.main.async {
                UIApplication.shared.applicationIconBadgeNumber = value
                callback?(true)
            }
        }
    }

    @objc func getBadgeCount(_ callback: LynxCallbackBlock?) {
        DispatchQueue.main.async {
            callback?(NSNumber(value: UIApplication.shared.applicationIconBadgeNumber))
        }
    }

    /// One-shot: return the payload that launched the app from a cold start,
    /// or nil. Subsequent calls return nil even if the original payload was
    /// non-nil — JS code that wants to react to launch payloads should call
    /// this exactly once during startup.
    @objc func getInitialNotification(_ callback: LynxCallbackBlock?) {
        if let payload = PushEventBus.shared.consumeInitialResponse() {
            callback?(payload)
        } else {
            callback?(NSNull())
        }
    }
}
