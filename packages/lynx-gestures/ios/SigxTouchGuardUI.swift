import Foundation
import UIKit
import Lynx

/// Native UI for the `<sigx-touch-guard>` JSX element on iOS — a plain
/// children-hosting container, shipped for tag symmetry with Android.
///
/// **Why it's a no-op here (#787):** the platform-touch fall-through the tag
/// exists to stop is Android-specific — on Android a Lynx `catchtap` overlay
/// blocks Lynx-level handlers but the raw `MotionEvent` still reaches native
/// views (EditText) underneath, while UIKit's hit-testing already resolves a
/// single touch target, so an overlay's view naturally shadows what's below
/// it. `SigxTouchGuardView.kt` consumes the Android touch stream; this class
/// just hosts the element (and its children) so the same JSX renders on both
/// platforms. `guard-enabled` is accepted and stored but changes nothing.
// Class is NOT marked `@objc` — Swift forbids that on generic subclasses of
// the ObjC lightweight-generic `LynxUI<__covariant V>`. Member-level `@objc`
// annotations still bridge because `LynxUI` itself is `@objc`, so the
// `__lynx_prop_config__*` discovery works.
public class SigxTouchGuardUI: LynxUI<UIView> {

    /// Stored for parity with Android; iOS needs no touch consumption.
    private var guardEnabled = true

    public override func createView() -> UIView? {
        let container = UIView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
        container.translatesAutoresizingMaskIntoConstraints = true
        container.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        return container
    }

    // MARK: - Prop setters

    // The runtime prefers this explicit table over `class_copyMethodList`
    // enumeration of the Swift metaclass (see SigxPinchUI for the rationale).
    @objc public class func propSetterLookUp() -> NSArray {
        return [
            ["guard-enabled", "setGuardEnabled:requestReset:"],
        ] as NSArray
    }

    // Bool props arrive boxed as `NSNumber` via the propSetterLookUp path
    // (a primitive `Bool` param would read pointer bits).
    @objc public func setGuardEnabled(_ value: NSNumber?, requestReset: Bool) {
        guardEnabled = value?.boolValue ?? true
    }
    @objc(__lynx_prop_config__guard_enabled)
    public class func __lynxPropConfigGuardEnabled() -> [String] {
        return ["guard-enabled", "setGuardEnabled", "NSNumber *"]
    }
}
