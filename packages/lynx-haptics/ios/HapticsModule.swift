import UIKit
import Lynx

/// Native haptic feedback module.
/// JS usage: NativeModules.Haptics.impact("medium")
class HapticsModule: NSObject, LynxModule {

    @objc static var name: String { "Haptics" }

    @objc static var methodLookup: [String: String] {
        [
            "impact": NSStringFromSelector(#selector(impact(_:))),
            "notification": NSStringFromSelector(#selector(notification(_:))),
            "selection": NSStringFromSelector(#selector(selection)),
            "diagnose": NSStringFromSelector(#selector(diagnose(_:))),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    @objc func impact(_ style: String?) {
        let feedbackStyle: UIImpactFeedbackGenerator.FeedbackStyle
        switch style ?? "medium" {
        case "light":  feedbackStyle = .light
        case "heavy":  feedbackStyle = .heavy
        case "rigid":  feedbackStyle = .rigid
        case "soft":   feedbackStyle = .soft
        default:       feedbackStyle = .medium
        }
        let generator = UIImpactFeedbackGenerator(style: feedbackStyle)
        generator.prepare()
        generator.impactOccurred()
    }

    @objc func notification(_ type: String?) {
        let notificationType: UINotificationFeedbackGenerator.FeedbackType
        switch type ?? "success" {
        case "warning": notificationType = .warning
        case "error":   notificationType = .error
        default:        notificationType = .success
        }
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(notificationType)
    }

    @objc func selection() {
        let generator = UISelectionFeedbackGenerator()
        generator.prepare()
        generator.selectionChanged()
    }

    /// Stub for parity with Android's diagnose. iOS feedback generators
    /// always work when the device's system haptics are enabled — there's
    /// no public API to introspect that state, so we just report a fixed
    /// "available" map.
    @objc func diagnose(_ callback: LynxCallbackBlock?) {
        callback?([
            "hasVibrator": true,
            "platform": "ios",
        ])
    }
}
