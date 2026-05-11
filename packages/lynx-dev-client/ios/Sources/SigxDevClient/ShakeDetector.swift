import UIKit
import SwiftUI
import ObjectiveC.runtime

public extension Notification.Name {
    static let sigxDeviceDidShake = Notification.Name("sigxDeviceDidShake")
}

/// Global shake detector for SwiftUI apps.
///
/// SwiftUI doesn't expose `UIWindow.motionEnded(_:with:)`, and Swift extensions
/// can't `override` inherited Obj-C methods. So we install a runtime swizzle:
/// `class_replaceMethod` adds our own `motionEnded:withEvent:` IMP onto
/// `UIWindow`, and our IMP forwards to the original `UIResponder` impl before
/// posting `.sigxDeviceDidShake` on the default notification center.
///
/// Idempotent — `enable()` is safe to call repeatedly; the swizzle runs once
/// thanks to Swift static-let initialisation semantics.
public enum SigxShakeDetector {
    private static let installed: Void = {
        installSwizzle()
    }()

    public static func enable() {
        _ = installed
    }

    private static func installSwizzle() {
        let cls: AnyClass = UIWindow.self
        let selector = #selector(UIResponder.motionEnded(_:with:))
        guard let method = class_getInstanceMethod(cls, selector) else { return }

        let originalIMP = method_getImplementation(method)
        let typeEncoding = method_getTypeEncoding(method)

        typealias Function = @convention(c) (UIWindow, Selector, UIEvent.EventSubtype, UIEvent?) -> Void
        let originalFunc = unsafeBitCast(originalIMP, to: Function.self)

        let block: @convention(block) (UIWindow, UIEvent.EventSubtype, UIEvent?) -> Void = { window, motion, event in
            originalFunc(window, selector, motion, event)
            if motion == .motionShake {
                NotificationCenter.default.post(name: .sigxDeviceDidShake, object: nil)
            }
        }
        let newIMP = imp_implementationWithBlock(block)
        class_replaceMethod(cls, selector, newIMP, typeEncoding)
    }
}

public extension View {
    /// Triggers `action` when the device is shaken. Installs a global UIWindow
    /// `motionEnded:` swizzle on first use so the event fires regardless of
    /// first-responder state.
    func onShake(perform action: @escaping () -> Void) -> some View {
        SigxShakeDetector.enable()
        return self.onReceive(NotificationCenter.default.publisher(for: .sigxDeviceDidShake)) { _ in
            action()
        }
    }
}
