import Foundation
import UIKit
import Lynx

/// Native UI for the `sigx-list` platform tag (#844) — `LynxUICollection`
/// (the engine's `<list>`) plus a frame-cheap bottom content inset.
///
/// Registered via the autolinker — `signalx-module.json`'s `ios.uiComponents`
/// produces `config.registerUI(SigxListUI.self, withName: "sigx-list")` in
/// the generated registry. The JS `<List>` opts in per element with
/// `custom-list-name="sigx-list"` (only when its `bottomInset` prop is set),
/// so every other `<list>` keeps the engine class.
///
/// `setBottomInset` mutates `collectionView.contentInset.bottom` DIRECTLY —
/// no CSS write, no starlight layout pass, and deliberately NO
/// invalidation context: cell layout attributes are content-coordinate, the
/// inset only moves the viewport, which is what makes it cheap enough for a
/// worklet-driven SharedValue to invoke per frame.
///
/// Composition points with the engine (all "call super, then apply delta" —
/// no engine logic copied):
///  - `updateFrame(_:withPadding:...)` overwrites `contentInset` from CSS
///    padding on every relayout (`LynxUICollection.m`) — re-add the extra.
///  - The engine scroller's `alignTo:"bottom"` targets the VIEWPORT bottom,
///    ignoring extra inset (`LynxCollectionScroller.m`: `targetOffset =
///    -offset + cellOffset - viewportH + cellH`, inset appears only in the
///    clamp) — so the chat re-pin would land under the keyboard. The
///    `scrollToPosition` override biases `offset` by `-extraBottomInset` for
///    bottom-aligned scrolls; the clamp is already inset-aware. (Android
///    needs no such bias — RecyclerView's scroller is padding-aware.)
// Class is NOT marked `@objc` — Swift forbids that on generic subclasses
// (`LynxUI<__covariant V>` is an ObjC lightweight generic). Member-level
// `@objc` / `@objc(name)` annotations still bridge; `LynxUIMethodProcessor`
// walks the superclass chain, so the engine's own list methods keep working.
public class SigxListUI: LynxUICollection {

    /// Extra bottom inset currently applied, in points (== CSS px on iOS).
    private var extraBottomInset: CGFloat = 0

    /// Status codes: `kUIMethodSuccess = 0`. Defined in the engine's ObjC
    /// headers; redefined locally (webview precedent) to avoid importing a
    /// private header just for one constant.
    private static let kUIMethodSuccess: Int32 = 0

    // MARK: - setBottomInset (per-frame UI method)

    /// `setBottomInset({ inset, pin })` — `inset` in CSS px, `pin` marks chat
    /// mode's stick-to-bottom so the newest item stays anchored above the
    /// inset (same-frame compensation, no `layoutcomplete` round trip).
    @objc public func setBottomInset(_ params: NSDictionary?,
                                     withResult callback: @escaping LynxUIMethodCallbackBlock) {
        let target = max(0, CGFloat((params?["inset"] as? NSNumber)?.doubleValue ?? 0))
        let pin = (params?["pin"] as? NSNumber)?.boolValue ?? false
        let delta = target - extraBottomInset
        guard delta != 0, let cv = self.view() else {
            callback(SigxListUI.kUIMethodSuccess, nil)
            return
        }
        // Pinned = at (or within 1pt of) max scroll BEFORE the change. Only a
        // pinned viewport is compensated: growing/shrinking the inset never
        // moves anchored content, so a reader scrolled up sees nothing shift.
        let maxBefore = maxContentOffsetY(cv)
        let wasPinned = pin && cv.contentOffset.y >= maxBefore - 1

        extraBottomInset = target
        // Delta-measured write: UIKit does not adjust contentOffset when the
        // bottom inset grows (adjustment only re-clamps when the offset falls
        // OUTSIDE the new range), but measure around the write anyway so any
        // OS-version surprise is folded into the compensation below.
        let offsetBefore = cv.contentOffset.y
        cv.contentInset.bottom += delta
        let osAdjustment = cv.contentOffset.y - offsetBefore

        if wasPinned {
            let maxAfter = maxContentOffsetY(cv)
            cv.setContentOffset(CGPoint(x: cv.contentOffset.x, y: maxAfter), animated: false)
        } else if osAdjustment != 0 {
            // Not pinned: anchored content must not move — undo any
            // auto-adjust the OS applied.
            cv.setContentOffset(CGPoint(x: cv.contentOffset.x, y: offsetBefore), animated: false)
        }
        callback(SigxListUI.kUIMethodSuccess, nil)
    }

    @objc(__lynx_ui_method_config__setBottomInset)
    dynamic public class func __lynxUIMethodConfigSetBottomInset() -> NSString {
        return "setBottomInset"
    }

    /// Max scrollable offset with the CURRENT insets — same formula as the
    /// engine scroller's clamp (`LynxCollectionScroller.m`).
    private func maxContentOffsetY(_ cv: UICollectionView) -> CGFloat {
        return max(-cv.contentInset.top,
                   cv.contentSize.height - cv.bounds.height + cv.contentInset.bottom)
    }

    // MARK: - Engine composition

    /// The engine overwrites `contentInset` from CSS padding on every
    /// relayout — stack the extra back on so the inset survives.
    public override func updateFrame(_ frame: CGRect,
                                     withPadding padding: UIEdgeInsets,
                                     border: UIEdgeInsets,
                                     margin: UIEdgeInsets,
                                     withLayoutAnimation with: Bool) {
        super.updateFrame(frame, withPadding: padding, border: border, margin: margin,
                          withLayoutAnimation: with)
        if extraBottomInset != 0 {
            self.view()?.contentInset.bottom += extraBottomInset
        }
    }

    /// Bias bottom-aligned scrolls by the extra inset (see the class doc).
    /// Same selector as the engine's category method (`LYNX_UI_METHOD
    /// (scrollToPosition)` in `LynxUICollection+Delegate.m`) — the method
    /// dispatch resolves dynamically, so this runtime override wins without
    /// re-declaring a `__lynx_ui_method_config__`; super is reached via an
    /// IMP cast because the category method has no public declaration.
    @objc(scrollToPosition:withResult:)
    public func scrollToPosition(_ params: NSDictionary?,
                                 withResult callback: @escaping LynxUIMethodCallbackBlock) {
        var forwarded = params
        if extraBottomInset != 0,
           (params?["alignTo"] as? String) == "bottom" {
            let mutable = NSMutableDictionary(dictionary: params ?? [:])
            let offset = (params?["offset"] as? NSNumber)?.doubleValue ?? 0
            mutable["offset"] = NSNumber(value: offset - Double(extraBottomInset))
            forwarded = mutable
        }
        let sel = NSSelectorFromString("scrollToPosition:withResult:")
        guard let superclass = class_getSuperclass(object_getClass(self)),
              let method = class_getInstanceMethod(superclass, sel) else {
            callback(SigxListUI.kUIMethodSuccess, nil)
            return
        }
        typealias ScrollFn = @convention(c) (
            AnyObject, Selector, NSDictionary?, @escaping LynxUIMethodCallbackBlock
        ) -> Void
        let imp = method_getImplementation(method)
        unsafeBitCast(imp, to: ScrollFn.self)(self, sel, forwarded, callback)
    }
}
