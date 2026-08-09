import UIKit
import Lynx

/// Publishes the host's current system color scheme (light / dark) to JS via:
///
/// 1. **`lynx.__globalProps.appearance`** — populated synchronously via
///    `LynxView.updateGlobalProps(withDictionary:)` before MT first paint, so
///    apps can render the correct theme on cold start without a flash.
///
/// 2. **`appearanceChanged` global event** — fired via
///    `LynxView.sendGlobalEvent(_:withParams:)` whenever the trait collection
///    flips light/dark. JS-side `<AppearanceProvider>` subscribes via
///    `lynx.getJSModule("GlobalEventEmitter").addListener` and updates its
///    reactive signal so consumers (e.g. `<ThemeProvider>` with `followSystem`)
///    swap themes live.
///
/// One publisher per `LynxView`. The autolinker wires
/// `GeneratedLifecyclePublishers.attachAll(to: lynxView)` to instantiate this
/// after each LynxView is built; the host coordinator retains the instance for
/// the LynxView's lifetime.
final class AppearancePublisher {
    private weak var lynxView: LynxView?
    private var lastScheme: String = ""

    init(lynxView: LynxView) {
        self.lynxView = lynxView

        // Observe trait-collection changes via the window — handles the
        // Settings → Display & Brightness → Appearance flip in real time.
        // UIScreen.traitCollectionDidChange isn't reliable here (only fires
        // when the screen *itself* changes), so we listen for the
        // app-foreground notification (catches changes made while the app was
        // backgrounded) and rely on the LynxContainerView's trait observer to
        // call back into us via `republish(scheme:)` on every real-time flip.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleAppearanceMayHaveChanged),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )

        // Real-time flips while the app is foregrounded: observe the
        // LynxView's own trait changes (iOS 17+). Before this, a foreground
        // Settings/Control-Center appearance flip reached neither JS nor the
        // engine until the next app-foreground (#951). The registration is
        // tied to the view's lifetime — no unregister needed.
        if #available(iOS 17.0, *) {
            // The publisher is constructed on the main thread (attachAll runs
            // from the view factory); assumeIsolated satisfies the MainActor
            // isolation of registerForTraitChanges without hopping queues.
            MainActor.assumeIsolated {
                lynxView.registerForTraitChanges([
                    UITraitUserInterfaceStyle.self
                ]) { [weak self] (_: UIView, _: UITraitCollection) in
                    self?.publish()
                }
            }
        }

        // Seed on the next runloop tick — the LynxView's window may not be
        // attached yet at construction time, so reading `traitCollection`
        // immediately can yield the unspecified style.
        DispatchQueue.main.async { [weak self] in
            self?.publish()
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func handleAppearanceMayHaveChanged() {
        publish()
    }

    /// Force a republish. Called from the seed tick, the app-foreground
    /// observer, and (optionally) from a host-side trait-collection observer
    /// that calls into `republish(scheme:)` when the real-time flip happens.
    @discardableResult
    @objc func publish() -> Bool {
        guard let view = lynxView else { return false }
        let style = view.traitCollection.userInterfaceStyle
        let scheme = style == .dark ? "dark" : "light"
        return republish(scheme: scheme)
    }

    @discardableResult
    func republish(scheme: String) -> Bool {
        guard let view = lynxView else { return false }
        if scheme == lastScheme { return false }
        lastScheme = scheme

        let map: [String: Any] = ["colorScheme": scheme]

        // Channel 0: the engine's own color scheme — drives
        // `@media (prefers-color-scheme)` natively, no JS round trip
        // (Lynx 4.0+, #951). The initial value is seeded at LynxView
        // construction via `builder.colorScheme`; this keeps live flips
        // in sync. (`update(_:)` is Swift's import of the ObjC
        // `updateColorScheme:` selector.)
        view.update(scheme == "dark" ? LynxColorScheme.dark : .light)

        // Channel 1: __globalProps — sync MT read at first paint.
        view.updateGlobalProps(with: ["appearance": map])

        // Channel 2: appearanceChanged event — live update for the BG-side
        // <AppearanceProvider> listener. First param is the map itself;
        // GlobalEventEmitter delivers it as the listener's first argument.
        view.sendGlobalEvent("appearanceChanged", withParams: [map])
        return true
    }
}
