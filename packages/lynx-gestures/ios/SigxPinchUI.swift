import Foundation
import UIKit
import Lynx

/// Native UI for the `<sigx-pinch>` JSX element — real two-finger pinch-zoom
/// and rotation, backed by UIKit's own recognizers.
///
/// **Why a native element rather than `Gesture.Pinch()`?** Lynx's gesture
/// arena reserves `PINCH`/`ROTATION` enum slots but ships no handler for them
/// in any released version (3.5→3.9) — the handler factory is a closed switch
/// compiled into the framework, so the builders never fire on native. Instead
/// we attach UIKit's first-class `UIPinchGestureRecognizer` /
/// `UIRotationGestureRecognizer` to this element's backing view (a public,
/// non-fork path), run them simultaneously, and apply the transform on the UI
/// thread for frame-perfect zoom/rotate with no thread hop.
///
/// The transform is applied to a `contentView` the element inserts *between*
/// its Lynx-managed container and the slotted children (see `insertChild`).
/// This keeps the transform off the container whose `frame` Lynx owns —
/// setting `.transform` on a frame-managed UIView is undefined behavior in
/// UIKit — while still visually scaling/rotating everything inside.
///
/// Prop / event surface (v1):
///   - `min-scale` / `max-scale`  → clamp the zoom (defaults 1 … 4)
///   - `enable-rotation`          → allow twist-to-rotate (default true)
///   - `enabled`                  → master gesture switch (default true)
///   - `bindgesturestart`         → `{ focalX, focalY }`
///   - `bindgesturechange`        → `{ scale, rotation, focalX, focalY }` (rotation = radians)
///   - `bindgestureend`           → `{ scale, rotation }`
///   - `.invoke('reset')`         → animate back to identity
// Class is NOT marked `@objc` — Swift forbids that on generic subclasses of
// the ObjC lightweight-generic `LynxUI<__covariant V>`. Member-level `@objc`
// annotations still bridge because `LynxUI` itself is `@objc`, so the
// `__lynx_prop_config__*` / `__lynx_ui_method_config__*` discovery works.
public class SigxPinchUI: LynxUI<UIView> {

    // MARK: - Gesture state

    /// Committed transform at the start of the current gesture — new deltas
    /// compose on top so successive pinches accumulate rather than snapping
    /// back to 1×.
    private var baseScale: CGFloat = 1
    private var baseRotation: CGFloat = 0
    /// Live values applied to `contentView` this frame.
    private var currentScale: CGFloat = 1
    private var currentRotation: CGFloat = 0

    private var minScale: CGFloat = 1
    private var maxScale: CGFloat = 4
    private var rotationEnabled = true
    private var gestureEnabled = true

    /// Holds the slotted children; the pinch/rotation transform lands here so
    /// it never collides with Lynx's frame management of `view()`.
    private lazy var contentView: UIView = {
        let v = UIView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
        v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        return v
    }()

    private lazy var grDelegate = SigxPinchGestureDelegate()

    private lazy var pinchGR: UIPinchGestureRecognizer = {
        let gr = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
        gr.delegate = grDelegate
        return gr
    }()

    private lazy var rotationGR: UIRotationGestureRecognizer = {
        let gr = UIRotationGestureRecognizer(target: self, action: #selector(handleRotation(_:)))
        gr.delegate = grDelegate
        return gr
    }()

    // MARK: - LynxUI overrides

    public override func createView() -> UIView? {
        let container = UIView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
        container.translatesAutoresizingMaskIntoConstraints = true
        container.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        // Don't clip — a zoomed card should grow past the element's own bounds
        // (the consumer clips if they want to). Clipping here hides the zoom.
        container.clipsToBounds = false
        contentView.frame = container.bounds
        container.addSubview(contentView)
        container.addGestureRecognizer(pinchGR)
        container.addGestureRecognizer(rotationGR)
        return container
    }

    // Reparent slotted children under `contentView`. Lynx keeps its own
    // `LynxUI` child reference and sets each child's `view.frame` directly
    // (independent of the actual superview), and `contentView` fills the
    // container in the same coordinate space — so moving the physical UIView
    // is transparent to layout while letting us transform the whole group.
    public override func insertChild(_ child: LynxUI<UIView>!, at index: Int) {
        super.insertChild(child, at: index)
        if let childView = child?.view() {
            // Preserve Lynx's child order in the native subview stack (z-order)
            // rather than always appending. Clamp — Lynx's index can transiently
            // exceed the current subview count during reconciliation.
            let at = max(0, min(index, contentView.subviews.count))
            contentView.insertSubview(childView, at: at)
        }
    }

    // MARK: - Prop setters

    // The runtime prefers this explicit table over `class_copyMethodList`
    // enumeration of the Swift metaclass (see SigxWebViewUI for the rationale).
    @objc public class func propSetterLookUp() -> NSArray {
        return [
            ["min-scale", "setMinScale:requestReset:"],
            ["max-scale", "setMaxScale:requestReset:"],
            ["enable-rotation", "setEnableRotation:requestReset:"],
            ["enabled", "setEnabled:requestReset:"],
            ["scale", "setScale:requestReset:"],
            ["rotation", "setRotation:requestReset:"],
        ] as NSArray
    }

    // Numeric props arrive boxed as `NSNumber` via the propSetterLookUp path
    // (a primitive `CGFloat` param would read pointer bits). `enable-*` bools
    // likewise arrive as `NSNumber`, not a primitive `Bool`.
    @objc public func setMinScale(_ value: NSNumber?, requestReset: Bool) {
        minScale = CGFloat(value?.doubleValue ?? 1)
    }
    @objc(__lynx_prop_config__min_scale)
    public class func __lynxPropConfigMinScale() -> [String] {
        return ["min-scale", "setMinScale", "NSNumber *"]
    }

    @objc public func setMaxScale(_ value: NSNumber?, requestReset: Bool) {
        maxScale = CGFloat(value?.doubleValue ?? 4)
    }
    @objc(__lynx_prop_config__max_scale)
    public class func __lynxPropConfigMaxScale() -> [String] {
        return ["max-scale", "setMaxScale", "NSNumber *"]
    }

    @objc public func setEnableRotation(_ value: NSNumber?, requestReset: Bool) {
        rotationEnabled = value?.boolValue ?? true
        rotationGR.isEnabled = rotationEnabled && gestureEnabled
    }
    @objc(__lynx_prop_config__enable_rotation)
    public class func __lynxPropConfigEnableRotation() -> [String] {
        return ["enable-rotation", "setEnableRotation", "NSNumber *"]
    }

    @objc public func setEnabled(_ value: NSNumber?, requestReset: Bool) {
        gestureEnabled = value?.boolValue ?? true
        pinchGR.isEnabled = gestureEnabled
        rotationGR.isEnabled = gestureEnabled && rotationEnabled
    }
    @objc(__lynx_prop_config__enabled)
    public class func __lynxPropConfigEnabled() -> [String] {
        return ["enabled", "setEnabled", "NSNumber *"]
    }

    // Controlled transform. Setting `scale`/`rotation` from JS drives the
    // content programmatically (e.g. sliders on hosts without multi-touch);
    // it also re-bases the gesture so a following pinch composes on top rather
    // than snapping. Applied on the main thread since it may arrive mid-flush.
    @objc public func setScale(_ value: NSNumber?, requestReset: Bool) {
        // Ignored while a gesture is active: the gesture owns the transform and
        // echoes its value back through this prop a frame late, which would
        // fight the live pinch (the "jumps back" symptom). See Android's
        // SigxPinchView for the same guard.
        if didEmitStart { return }
        let s = clampScale(CGFloat(value?.doubleValue ?? 1))
        if s == currentScale { return }
        currentScale = s
        baseScale = s
        applyTransform()
    }
    @objc(__lynx_prop_config__scale)
    public class func __lynxPropConfigScale() -> [String] {
        return ["scale", "setScale", "NSNumber *"]
    }

    @objc public func setRotation(_ value: NSNumber?, requestReset: Bool) {
        if didEmitStart { return } // ignore controlled prop mid-gesture (see setScale)
        let r = CGFloat(value?.doubleValue ?? 0) // radians
        if r == currentRotation { return }
        currentRotation = r
        baseRotation = r
        applyTransform()
    }
    @objc(__lynx_prop_config__rotation)
    public class func __lynxPropConfigRotation() -> [String] {
        return ["rotation", "setRotation", "NSNumber *"]
    }

    // MARK: - Imperative methods

    private static let kUIMethodSuccess: Int32 = 0

    /// Spring the content back to its untransformed state.
    @objc public func reset(_ params: NSDictionary?, withResult callback: @escaping LynxUIMethodCallbackBlock) {
        DispatchQueue.main.async {
            self.baseScale = 1
            self.baseRotation = 0
            self.currentScale = 1
            self.currentRotation = 0
            UIView.animate(withDuration: 0.25) {
                self.contentView.transform = .identity
            }
            callback(SigxPinchUI.kUIMethodSuccess, nil)
        }
    }
    @objc(__lynx_ui_method_config__reset)
    dynamic public class func __lynxUIMethodConfigReset() -> NSString { return "reset" }

    // MARK: - Gesture handling

    @objc private func handlePinch(_ gr: UIPinchGestureRecognizer) {
        switch gr.state {
        case .began:
            baseScale = currentScale
            emitStart(gr.location(in: view()))
        case .changed:
            currentScale = clampScale(baseScale * gr.scale)
            applyTransform()
            emitChange(focal: gr.location(in: view()))
        case .ended, .cancelled, .failed:
            baseScale = currentScale
            emitEnd()
        default:
            break
        }
    }

    @objc private func handleRotation(_ gr: UIRotationGestureRecognizer) {
        switch gr.state {
        case .began:
            baseRotation = currentRotation
        case .changed:
            currentRotation = baseRotation + gr.rotation
            applyTransform()
            emitChange(focal: gr.location(in: view()))
        case .ended, .cancelled, .failed:
            baseRotation = currentRotation
            emitEnd()
        default:
            break
        }
    }

    private func clampScale(_ v: CGFloat) -> CGFloat {
        return min(maxScale, max(minScale, v))
    }

    private func applyTransform() {
        contentView.transform = CGAffineTransform(scaleX: currentScale, y: currentScale)
            .rotated(by: currentRotation)
    }

    // MARK: - Event firing

    private var didEmitStart = false
    /// Timestamp of the last `gesturechange` — throttles the JS event.
    private var lastEmitTime: CFTimeInterval = 0
    /// ~30/sec. Lynx rate-limits DispatchEvent (error 204 "called too
    /// frequently" after ~800 in a window); a 60fps gesture would trip it. The
    /// transform still applies every frame; `emitEnd` sends the final value.
    private static let emitThrottle: CFTimeInterval = 0.033

    private func emitStart(_ focal: CGPoint) {
        // Pinch and rotation both begin; only fire one `gesturestart`.
        if didEmitStart { return }
        didEmitStart = true
        lastEmitTime = 0 // let the first change through immediately
        fireEvent("gesturestart", params: ["focalX": focal.x, "focalY": focal.y])
    }

    private func emitChange(focal: CGPoint) {
        let now = CACurrentMediaTime()
        if now - lastEmitTime < SigxPinchUI.emitThrottle { return }
        lastEmitTime = now
        fireEvent("gesturechange", params: [
            "scale": currentScale,
            "rotation": currentRotation,
            "focalX": focal.x,
            "focalY": focal.y,
        ])
    }

    private func emitEnd() {
        // Only fire `gestureend` once both recognizers have finished — a
        // pinch can end a frame before the rotation (or vice versa).
        if pinchGR.state == .changed || pinchGR.state == .began { return }
        if rotationEnabled && (rotationGR.state == .changed || rotationGR.state == .began) { return }
        didEmitStart = false
        fireEvent("gestureend", params: ["scale": currentScale, "rotation": currentRotation])
    }

    private func fireEvent(_ name: String, params: [String: Any]) {
        let event = LynxCustomEvent(name: name, targetSign: sign, params: params)
        context?.eventEmitter?.send(event)
    }
}

/// Lets the pinch and rotation recognizers run at the same time (two fingers
/// drive both), and alongside Lynx's own touch pipeline. Mirrors the
/// simultaneous-recognition pattern Lynx itself uses in
/// `LynxGestureFlingTrigger`.
final class SigxPinchGestureDelegate: NSObject, UIGestureRecognizerDelegate {
    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
    ) -> Bool {
        return true
    }
}
