import UIKit
import Lynx

/// Publishes the live viewport size + interface orientation to JS (#856) and
/// keeps the Lynx layout viewport in sync with it.
///
/// Two publish channels, the house pattern:
///
/// 1. **`lynx.__globalProps.screen`** — `{ width, height, scale, orientation }`
///    (points) written with `updateGlobalProps(with:)` before MT first paint,
///    so the first render already knows whether it's laying out in landscape.
///    `__globalProps` is mirrored onto both threads, which makes this the
///    BG-safe screen-size accessor `lynx.SystemInfo` can't be (#333).
/// 2. **`screenChanged` global event** — fired after each republish; the JS
///    `useScreen()` signal listens through `GlobalEventEmitter`.
///
/// It ALSO does the work that makes rotation function at all on iOS. The host
/// builds the LynxView with `preferredLayoutWidth/Height` pinned to the launch
/// size and `layoutWidthMode/HeightMode = .exact`, so without this the engine
/// keeps laying out at the original dimensions forever. On every size change
/// the publisher re-pins those and calls `updateViewport(…needLayout: true)`.
///
/// Order matters: `updateScreenMetrics` explicitly does *not* relayout (see
/// `LynxView.h`) — it only re-bases `rpx` — so the viewport update has to
/// follow it.
///
/// Size signal is the LynxView's own `bounds`, observed with KVO: it covers
/// rotation, iPad Split View and Stage Manager alike, whereas
/// `UIScreen.main.bounds` misses split-view and `UIDevice.orientation` reports
/// device (not interface) orientation, including face-up/face-down.
/// Notifications are observed too, since a rotation that keeps the view square
/// still changes `orientation`.
///
/// Lifecycle: one instance per LynxView, retained by the host (the generated
/// `GeneratedLifecyclePublishers.attachAll(to:)` list).
final class ScreenMetricsPublisher: NSObject {
    private weak var lynxView: LynxView?
    private var observingBounds = false

    private var lastWidth: CGFloat = 0
    private var lastHeight: CGFloat = 0
    private var lastOrientation = ""

    init(lynxView: LynxView) {
        self.lynxView = lynxView
        super.init()

        // `orientationDidChangeNotification` is only posted while device-
        // orientation generation is on. UIKit usually turns it on for you once
        // a window exists, but that isn't contractual — begin explicitly (the
        // counter is ref-counted, so this composes with any other observer)
        // and end it in deinit.
        UIDevice.current.beginGeneratingDeviceOrientationNotifications()

        let center = NotificationCenter.default
        center.addObserver(
            self,
            selector: #selector(handleNotification),
            name: UIDevice.orientationDidChangeNotification,
            object: nil
        )
        center.addObserver(
            self,
            selector: #selector(handleNotification),
            name: UIWindow.didBecomeKeyNotification,
            object: nil
        )
        center.addObserver(
            self,
            selector: #selector(handleNotification),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )

        lynxView.addObserver(self, forKeyPath: "bounds", options: [.new], context: nil)
        observingBounds = true

        // Seed synchronously so __globalProps is populated before MT first
        // paint. The view has no layout yet at this point, so this first
        // publish comes from the window/screen; the KVO callback corrects it
        // the moment the view is laid out.
        publish()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        UIDevice.current.endGeneratingDeviceOrientationNotifications()
        if observingBounds {
            lynxView?.removeObserver(self, forKeyPath: "bounds")
        }
    }

    override func observeValue(
        forKeyPath keyPath: String?,
        of object: Any?,
        change: [NSKeyValueChangeKey: Any]?,
        context: UnsafeMutableRawPointer?
    ) {
        guard keyPath == "bounds" else { return }
        publish()
    }

    @objc private func handleNotification() {
        // Rotation notifications fire before the layout settles — re-read on
        // the next runloop tick so the bounds we publish are the new ones.
        DispatchQueue.main.async { [weak self] in
            self?.publish()
        }
    }

    /// Current interface orientation as the JS `ScreenOrientation` union.
    /// Read from the window scene, not `UIDevice.current.orientation`, which
    /// reports the physical device (and has face-up/face-down states that
    /// aren't interface orientations at all).
    private func orientationName(for size: CGSize) -> String {
        let interface = lynxView?.window?.windowScene?.interfaceOrientation
        switch interface {
        case .portrait: return "portrait"
        case .portraitUpsideDown: return "portrait-upside-down"
        // UIKit names landscape by where the home button ends up, the opposite
        // of the device-rotation direction the JS union uses.
        case .landscapeLeft: return "landscape-right"
        case .landscapeRight: return "landscape-left"
        default: return size.width > size.height ? "landscape-left" : "portrait"
        }
    }

    private func publish() {
        guard let view = lynxView else { return }

        // The LynxView's own bounds are the authority; before first layout
        // fall back to its window, then the screen.
        var size = view.bounds.size
        if size.width <= 0 || size.height <= 0 {
            size = view.window?.bounds.size ?? UIScreen.main.bounds.size
        }
        guard size.width > 0, size.height > 0 else { return }

        let orientation = orientationName(for: size)
        if size.width == lastWidth, size.height == lastHeight, orientation == lastOrientation {
            return
        }
        let sizeChanged = size.width != lastWidth || size.height != lastHeight
        lastWidth = size.width
        lastHeight = size.height
        lastOrientation = orientation

        let scale = view.window?.screen.scale ?? UIScreen.main.scale
        let map: [String: Any] = [
            "width": Double(size.width),
            "height": Double(size.height),
            "scale": Double(scale),
            "orientation": orientation,
        ]

        if sizeChanged {
            // 1. Re-base `rpx` against the new screen size. Does not relayout.
            view.updateScreenMetrics(withWidth: size.width, height: size.height)
            // 2. Re-pin the exact-mode layout box the host set at build time…
            view.preferredLayoutWidth = size.width
            view.preferredLayoutHeight = size.height
            // 3. …and relayout against it. Without this the engine keeps the
            //    launch-time viewport and the app renders portrait-shaped
            //    content in a landscape window.
            view.updateViewport(
                withPreferredLayoutWidth: size.width,
                preferredLayoutHeight: size.height,
                needLayout: true
            )
        }

        // Channel 1: __globalProps — sync MT/BG read at first paint.
        view.updateGlobalProps(with: ["screen": map])
        // Channel 2: screenChanged event — live update for `useScreen()`.
        view.sendGlobalEvent("screenChanged", withParams: [map])
    }
}
