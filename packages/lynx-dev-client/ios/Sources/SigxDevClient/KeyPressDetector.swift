import UIKit
import SwiftUI
import ObjectiveC.runtime

public extension Notification.Name {
    /// Posted when the hardware keyboard fires `R` (with or without ⌘) while
    /// no first responder consumed it — i.e. the user is on a screen without
    /// an active text input, like the iOS Simulator window in dev mode.
    static let sigxDevKeyReload = Notification.Name("sigxDevKeyReload")

    /// Posted when ⌘D is pressed and bubbles up to UIWindow. Reserved for a
    /// future "open dev menu" shortcut — declared here so callers can wire
    /// `.onReceive` without us needing another swizzle later.
    static let sigxDevKeyDevMenu = Notification.Name("sigxDevKeyDevMenu")
}

/// Global keyboard-shortcut detector for SwiftUI apps. Mirrors
/// `SigxShakeDetector` — installs a runtime swizzle on
/// `UIWindow.pressesEnded(_:with:)` so dev shortcuts work regardless of
/// first-responder state.
///
/// Only fires when the press bubbles up to `UIWindow`, which means a text
/// input that wants the `R` key still receives it. The shortcut becomes
/// active when no first responder consumes the press — which is the common
/// case in iOS Simulator while you're staring at a Lynx-rendered screen.
///
/// Idempotent — `enable()` is safe to call repeatedly; the swizzle runs once
/// thanks to Swift static-let initialisation semantics.
public enum SigxKeyPressDetector {
    private static let installed: Void = {
        // Install the first-responder probe method on `UIResponder` so the
        // text-input guard inside the pressesEnded block can find the active
        // first responder via `UIApplication.sendAction(to: nil, …)`.
        _ = _SigxFirstResponderCapture.installed
        installSwizzle()
    }()

    public static func enable() {
        _ = installed
    }

    private static func installSwizzle() {
        let cls: AnyClass = UIWindow.self
        let selector = #selector(UIResponder.pressesEnded(_:with:))
        guard let method = class_getInstanceMethod(cls, selector) else { return }

        let originalIMP = method_getImplementation(method)
        let typeEncoding = method_getTypeEncoding(method)

        typealias Function = @convention(c) (UIWindow, Selector, Set<UIPress>, UIPressesEvent?) -> Void
        let originalFunc = unsafeBitCast(originalIMP, to: Function.self)

        let block: @convention(block) (UIWindow, Set<UIPress>, UIPressesEvent?) -> Void = { window, presses, event in
            originalFunc(window, selector, presses, event)
            for press in presses {
                guard let key = press.key else { continue }
                // `charactersIgnoringModifiers` keeps the shortcut working
                // whether the user types `r` or `⌘R`. Map to lowercase so
                // shift-locked input still hits the same branch.
                let chars = key.charactersIgnoringModifiers.lowercased()
                let hasCmd = key.modifierFlags.contains(.command)

                if chars == "r" {
                    // Plain `r` is suppressed when a text input is the active
                    // first responder so typing into a `<input>` doesn't
                    // accidentally reload the bundle. `⌘R` always reloads —
                    // it's never produced by a normal keystroke into a field.
                    if hasCmd || !isTextInputFocused() {
                        NotificationCenter.default.post(name: .sigxDevKeyReload, object: nil)
                    }
                } else if chars == "d" && hasCmd {
                    NotificationCenter.default.post(name: .sigxDevKeyDevMenu, object: nil)
                }
            }
        }
        let newIMP = imp_implementationWithBlock(block)
        class_replaceMethod(cls, selector, newIMP, typeEncoding)
    }
}

/// Probe whether the current first responder conforms to `UITextInput`
/// (i.e. an editable text field, text view, or similar). Used by the
/// reload-key swizzle to skip plain-`R` events while the user is typing.
///
/// Implementation uses the standard "send-action-to-nil" trick: calling
/// `sendAction(_:to: nil, …)` makes UIKit route the action up the responder
/// chain to whichever responder claims it. The selector lives on
/// `UIResponder` (declared via Obj-C runtime so we don't need a `.m` file),
/// and when invoked `self` *is* the first responder. We stash it on a
/// static and read it back synchronously.
private func isTextInputFocused() -> Bool {
    _SigxFirstResponderCapture.lastResponder = nil
    UIApplication.shared.sendAction(
        Selector(("_sigxCaptureFirstResponder:")),
        to: nil,
        from: nil,
        for: nil,
    )
    return _SigxFirstResponderCapture.lastResponder is UITextInput
}

private enum _SigxFirstResponderCapture {
    static weak var lastResponder: UIResponder?

    /// Install an Obj-C method on `UIResponder` named
    /// `_sigxCaptureFirstResponder:` that records `self` into
    /// `lastResponder`. Runs once thanks to Swift static-let semantics.
    static let installed: Void = {
        let cls: AnyClass = UIResponder.self
        let sel = Selector(("_sigxCaptureFirstResponder:"))
        let block: @convention(block) (UIResponder, Any?) -> Void = { responder, _ in
            lastResponder = responder
        }
        let imp = imp_implementationWithBlock(block)
        // Method signature: `void method(id self, SEL _cmd, id sender)`
        // (v@:@ in Obj-C type encoding terms).
        class_addMethod(cls, sel, imp, "v@:@")
    }()
}

public extension View {
    /// Triggers `action` when the user presses `R` (with or without ⌘) and
    /// no other view consumed the press. Installs a global UIWindow
    /// `pressesEnded:` swizzle on first use so the shortcut fires across
    /// the whole app regardless of first-responder state.
    ///
    /// Use this for dev-only affordances ("reload from the simulator
    /// window"); never gate production behaviour on it.
    func onDevReloadKey(perform action: @escaping () -> Void) -> some View {
        SigxKeyPressDetector.enable()
        return self.onReceive(NotificationCenter.default.publisher(for: .sigxDevKeyReload)) { _ in
            action()
        }
    }
}
