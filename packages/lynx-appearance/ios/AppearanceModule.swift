import UIKit
import Lynx

/// System-bar appearance setters + a sync getter for the current color scheme.
/// JS usage:
///   NativeModules.Appearance.setStatusBarStyle({ "style": "light" }, callback)
///   NativeModules.Appearance.getColorScheme(callback)
///
/// iOS exposes two routes to control status-bar style; we try both so apps
/// don't have to wire boilerplate:
///
/// 1. **VC-controlled (modern, default)** — iOS reads
///    `preferredStatusBarStyle` from the root view controller. The host app
///    overrides that getter to return `AppearanceModule.preferredStatusBarStyle`
///    (the static we update). We call `setNeedsStatusBarAppearanceUpdate()` to
///    force a re-evaluation.
///
/// 2. **UIApplication-controlled (legacy)** — if the host's Info.plist has
///    `UIViewControllerBasedStatusBarAppearance = NO`, iOS reads style from
///    `UIApplication.shared` directly. We invoke the deprecated setter via
///    `perform(_:with:with:)` so SwiftUI hosts (which can't easily override
///    their hidden UIHostingController) get a working path with one plist
///    change. Apps that leave the plist default (YES) get the silent no-op
///    for this leg — Path 1 covers them.
///
/// `setStatusBarBackgroundColor` and `setNavigationBarStyle` are Android-only
/// in practice. iOS resolves the system-bar background from the underlying
/// view's color and has no separate navigation bar. We return
/// `{ ok: false, reason: "unsupported" }` so JS callers can decide whether to
/// treat that as an error.
class AppearanceModule: NSObject, LynxModule {

    /// Last requested status-bar style; the host VC's
    /// `preferredStatusBarStyle` should return this.
    @objc public static var preferredStatusBarStyle: UIStatusBarStyle = .default

    @objc static var name: String { "Appearance" }

    @objc static var methodLookup: [String: String] {
        [
            "setStatusBarStyle": NSStringFromSelector(#selector(setStatusBarStyle(_:callback:))),
            "setStatusBarBackgroundColor": NSStringFromSelector(#selector(setStatusBarBackgroundColor(_:callback:))),
            "setNavigationBarStyle": NSStringFromSelector(#selector(setNavigationBarStyle(_:callback:))),
            "getColorScheme": NSStringFromSelector(#selector(getColorScheme(_:))),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    @objc func setStatusBarStyle(_ params: [String: Any]?, callback: LynxCallbackBlock?) {
        let style = (params?["style"] as? String) ?? "default"
        // 'light' style means "light content" — i.e. white icons on a dark
        // background. 'dark' means dark icons on a light background.
        // iOS uses lightContent / darkContent to express the *content* color.
        let resolved: UIStatusBarStyle
        switch style {
        case "light":
            resolved = .lightContent
        case "dark":
            resolved = .darkContent
        default:
            resolved = .default
        }

        DispatchQueue.main.async {
            AppearanceModule.preferredStatusBarStyle = resolved

            // Path 1 — VC-controlled (the modern, recommended path):
            // re-evaluate `preferredStatusBarStyle` on every key window's
            // root view controller. The host app's VC must override
            // `preferredStatusBarStyle` to return
            // `AppearanceModule.preferredStatusBarStyle` for this to take
            // effect.
            for scene in UIApplication.shared.connectedScenes {
                guard let windowScene = scene as? UIWindowScene else { continue }
                for window in windowScene.windows {
                    window.rootViewController?.setNeedsStatusBarAppearanceUpdate()
                }
            }

            // Path 2 — UIApplication-controlled (legacy, deprecated but
            // still functional when `UIViewControllerBasedStatusBarAppearance`
            // is `false` in Info.plist). For SwiftUI hosts where overriding
            // a UIHostingController's preferredStatusBarStyle is awkward,
            // setting that plist key to NO and letting this path do the work
            // is the path of least resistance. No-op on apps that leave the
            // plist key default (true) — iOS silently ignores the call.
            //
            // Invoked via `perform(_:with:with:)` so the deprecation warning
            // doesn't fire at this single intentional call site.
            let plist = Bundle.main.infoDictionary
            let vcBased = (plist?["UIViewControllerBasedStatusBarAppearance"] as? Bool) ?? true
            if !vcBased {
                let app = UIApplication.shared
                let sel = NSSelectorFromString("setStatusBarStyle:animated:")
                if app.responds(to: sel) {
                    app.perform(sel, with: resolved.rawValue, with: true)
                }
            }

            callback?(["ok": true])
        }
    }

    @objc func setStatusBarBackgroundColor(_ params: [String: Any]?, callback: LynxCallbackBlock?) {
        // No-op on iOS — the status bar background is the underlying view's
        // color, not a system property we can set.
        _ = params
        callback?(["ok": false, "reason": "unsupported"])
    }

    @objc func setNavigationBarStyle(_ params: [String: Any]?, callback: LynxCallbackBlock?) {
        // No-op on iOS — there's no separate navigation bar to style.
        _ = params
        callback?(["ok": false, "reason": "unsupported"])
    }

    @objc func getColorScheme(_ callback: LynxCallbackBlock?) {
        // Read from the active key window so we pick up the user's preference
        // even if no LynxView has fired its publisher yet.
        let style = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first(where: { $0.activationState == .foregroundActive })?
            .windows.first?.traitCollection.userInterfaceStyle
            ?? UITraitCollection.current.userInterfaceStyle
        let scheme = style == .dark ? "dark" : "light"
        callback?(["colorScheme": scheme])
    }
}
