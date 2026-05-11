import UIKit
import Lynx

/// Publishes the device safe-area insets (notch, home indicator, status bar,
/// keyboard) to JS via two channels:
///
/// 1. **`lynx.__globalProps.safeArea`** — populated synchronously via
///    `LynxView.updateGlobalProps(withDictionary:)`. This is what enables
///    inset-aware first paint: the MT bundle reads `__globalProps`
///    synchronously before its first render, so the initial layout already
///    respects the notch.
///
/// 2. **`safeAreaChanged` global event** — fired via
///    `LynxView.sendGlobalEvent(_:withParams:)` after each republish. The JS
///    side subscribes via `lynx.getJSModule("GlobalEventEmitter").addListener`
///    and updates the `<SafeAreaProvider>`'s reactive signal. Drives live
///    updates on rotation, split-view, keyboard appearance.
///
/// Lifecycle is tied to a single `LynxView` instance — instantiate once per
/// LynxView, retain it for the LynxView's lifetime, drop the reference when
/// the LynxView is torn down. Publishers attached to multiple LynxViews are
/// independent: each observes its own keyWindow / orientation state.
final class SafeAreaPublisher {
    private weak var lynxView: LynxView?
    private var keyboardHeight: CGFloat = 0

    init(lynxView: LynxView) {
        self.lynxView = lynxView

        // Observe sources that change device safe-area insets:
        let center = NotificationCenter.default
        center.addObserver(
            self,
            selector: #selector(handleNotification),
            name: UIDevice.orientationDidChangeNotification,
            object: nil
        )
        center.addObserver(
            self,
            selector: #selector(handleKeyboardWillShow(_:)),
            name: UIResponder.keyboardWillShowNotification,
            object: nil
        )
        center.addObserver(
            self,
            selector: #selector(handleKeyboardWillHide(_:)),
            name: UIResponder.keyboardWillHideNotification,
            object: nil
        )
        center.addObserver(
            self,
            selector: #selector(handleKeyboardWillChangeFrame(_:)),
            name: UIResponder.keyboardWillChangeFrameNotification,
            object: nil
        )
        center.addObserver(
            self,
            selector: #selector(handleNotification),
            name: UIWindow.didBecomeKeyNotification,
            object: nil
        )

        // Subscribe to app-foreground notification — fires reliably once the
        // app's key window is fully attached and laid out (catches the common
        // case where SwiftUI takes longer than our retry window to attach
        // the LynxView).
        center.addObserver(
            self,
            selector: #selector(handleNotification),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )

        // Seed the first publish on the next runloop tick. `publish()`
        // already has a key-window fallback if `lynxView.window` is nil, so
        // we always invoke it — and retry until we get NON-ZERO insets,
        // which is the actual failure mode we're guarding against (a window
        // exists but its safeAreaInsets haven't been computed yet during
        // very early app boot).
        seedRetry(remaining: 30)
    }

    private func seedRetry(remaining: Int) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let succeeded = self.publish()
            // Stop once we've published meaningful insets OR we've exhausted
            // the retry budget. Publishing zeros early is fine — the
            // notification observers will republish later when real insets
            // become available (rotation, app foreground, keyboard).
            if !succeeded && remaining > 0 {
                self.seedRetry(remaining: remaining - 1)
            }
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    /// Force a republish (initial seed and notification handlers all funnel
    /// here). Returns `true` if a non-zero inset map was published, `false`
    /// if all insets were zero — the seed retry loop uses this to decide
    /// whether to retry. Notification-driven calls (`@objc` selectors) just
    /// discard the return value.
    @discardableResult
    @objc func publish() -> Bool {
        guard let view = lynxView else { return false }

        // Prefer the LynxView's own window when available (handles multi-
        // window scenes correctly). Fall back to the active scene's
        // keyWindow, then the application keyWindow as a last resort.
        let window = view.window
            ?? UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first(where: { $0.activationState == .foregroundActive })?
                .windows.first(where: { $0.isKeyWindow })
            ?? UIApplication.shared.windows.first(where: { $0.isKeyWindow })

        let insets: UIEdgeInsets = window?.safeAreaInsets ?? .zero
        let statusBarHeight: CGFloat
        if let scene = window?.windowScene {
            statusBarHeight = scene.statusBarManager?.statusBarFrame.height ?? insets.top
        } else {
            statusBarHeight = insets.top
        }

        let map: [String: Any] = [
            "top": Double(insets.top),
            "right": Double(insets.right),
            "bottom": Double(insets.bottom),
            "left": Double(insets.left),
            "keyboard": Double(keyboardHeight),
            "statusBar": Double(statusBarHeight),
            // iOS doesn't have a separate navigation bar — set 0 for
            // platform parity with Android.
            "navigationBar": 0.0,
        ]

        // Channel 1: __globalProps — readable synchronously on MT for first paint.
        view.updateGlobalProps(with: ["safeArea": map])

        // Channel 2: safeAreaChanged event — live update for the BG-side
        // <SafeAreaProvider> listener. The first param is the inset map
        // itself; emitter.addListener receives it as the listener's first
        // argument (see GlobalEventEmitter contract in @lynx-js/types).
        view.sendGlobalEvent("safeAreaChanged", withParams: [map])

        // Considered a successful publish only if at least one edge has a
        // non-zero inset. Devices without notches/home indicators have
        // legitimately zero insets, but those devices also don't expose
        // a status bar height of zero — so the disjunction is reliable.
        return insets.top > 0 || insets.bottom > 0
            || insets.left > 0 || insets.right > 0
            || statusBarHeight > 0
    }

    @objc private func handleNotification() {
        publish()
    }

    @objc private func handleKeyboardWillShow(_ note: Notification) {
        keyboardHeight = readKeyboardHeight(note)
        publish()
    }

    @objc private func handleKeyboardWillHide(_ note: Notification) {
        keyboardHeight = 0
        publish()
    }

    @objc private func handleKeyboardWillChangeFrame(_ note: Notification) {
        keyboardHeight = readKeyboardHeight(note)
        publish()
    }

    private func readKeyboardHeight(_ note: Notification) -> CGFloat {
        guard let frame = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue,
              let window = lynxView?.window else { return 0 }
        // Convert keyboard frame from screen coords into the LynxView's
        // window coordinate space, intersect with the LynxView's bounds,
        // and report the visible portion's height. This handles split-view
        // / floating-keyboard / iPad detached keyboard correctly.
        let windowFrame = window.convert(frame, from: nil)
        let viewFrame = lynxView?.convert(lynxView!.bounds, to: window) ?? .zero
        let intersection = viewFrame.intersection(windowFrame)
        return intersection.isNull ? 0 : intersection.height
    }
}
