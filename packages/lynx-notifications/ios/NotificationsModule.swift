import Foundation
import UserNotifications
import Lynx

/// Local notifications module.
/// JS usage: NativeModules.Notifications.schedule({ title, body }, { delay }, callback)
class NotificationsModule: NSObject, LynxModule {

    @objc static var name: String { "Notifications" }

    @objc static var methodLookup: [String: String] {
        [
            "schedule": NSStringFromSelector(#selector(schedule(_:options:callback:))),
            "cancel": NSStringFromSelector(#selector(cancel(_:callback:))),
            "cancelAll": NSStringFromSelector(#selector(cancelAll(_:))),
            "requestPermission": NSStringFromSelector(#selector(requestPermission(_:))),
            "getPermissionStatus": NSStringFromSelector(#selector(getPermissionStatus(_:))),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    @objc func schedule(_ content: [String: Any]?, options: [String: Any]?, callback: LynxCallbackBlock?) {
        let title = content?["title"] as? String ?? "Notification"
        let body = content?["body"] as? String ?? ""
        let delay = options?["delay"] as? TimeInterval ?? 0

        let notificationId = UUID().uuidString

        let notificationContent = UNMutableNotificationContent()
        notificationContent.title = title
        notificationContent.body = body
        notificationContent.sound = .default

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
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [notificationId])
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [notificationId])
        callback?(true)
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
}
