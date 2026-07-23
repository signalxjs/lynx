import UIKit
import Lynx

/// Publishes the OS text-size setting (Dynamic Type) to the LynxView and JS:
///
/// 1. **`lynx.__globalProps.fontScale`** — `{ scale, os }` populated
///    synchronously via `LynxView.updateGlobalProps(with:)` before MT first
///    paint (`scale` = policy-clamped effective value the engine applies,
///    `os` = raw unclamped OS value).
///
/// 2. **`LynxView.updateFontScale(_:)`** — pushes the effective scale into the
///    engine on every Dynamic Type change; the engine relayouts and emits the
///    `onFontScaleChanged` global event to JS itself, so no custom change
///    event is needed here.
///
/// The builder-time `builder.fontScale` seed (managed ContentView template)
/// covers first layout; the `updateFontScale` call in `init` is a no-op then,
/// but makes the publisher self-sufficient for custom hosts that omit the
/// builder seed.
///
/// One publisher per `LynxView`, instantiated by the generated
/// `GeneratedLifecyclePublishers.attachAll(to:)` and retained by the host
/// coordinator for the view's lifetime.
final class FontScalePublisher {
    private weak var lynxView: LynxView?
    private var lastEffective: CGFloat = 0

    init(lynxView: LynxView) {
        self.lynxView = lynxView

        let center = NotificationCenter.default
        // Real-time Dynamic Type changes (Settings, Control Center slider).
        center.addObserver(
            self,
            selector: #selector(handleFontScaleMayHaveChanged),
            name: UIContentSizeCategory.didChangeNotification,
            object: nil
        )
        // Catches changes made while the app was backgrounded — the dedupe in
        // `publish()` makes the extra observer free when nothing changed.
        center.addObserver(
            self,
            selector: #selector(handleFontScaleMayHaveChanged),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )

        // Seed synchronously: the content size category is app-level (no
        // window needed, unlike the appearance publisher's trait read), and
        // __globalProps must land before MT first paint.
        publish()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func handleFontScaleMayHaveChanged() {
        publish()
    }

    private func publish() {
        guard let view = lynxView else { return }
        let effective = SigxFontScale.effectiveScale()
        if effective == lastEffective { return }
        lastEffective = effective

        // `os` is only re-read alongside an effective change, so a clamped
        // app sees the raw value move with the paint it accompanies; JS-side
        // live updates ride the engine's own onFontScaleChanged event.
        view.updateGlobalProps(with: [
            "fontScale": ["scale": effective, "os": SigxFontScale.osScale()],
        ])
        view.updateFontScale(effective)
    }
}
