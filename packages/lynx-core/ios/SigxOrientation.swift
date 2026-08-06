import UIKit

/// Runtime orientation lock (#856).
///
/// **The host must forward `supportedInterfaceOrientations` here**, otherwise a
/// runtime lock has nothing to constrain. The managed `App.swift` template does
/// it in its `AppDelegate`:
///
/// ```swift
/// func application(_ application: UIApplication,
///                  supportedInterfaceOrientationsFor window: UIWindow?)
///     -> UIInterfaceOrientationMask {
///     SigxOrientation.supportedMask(default: [.portrait])
/// }
/// ```
///
/// Implementing that delegate method *overrides* `Info.plist` entirely, which
/// is why the default mask is stamped from `signalx.config.ts`'s `orientation`
/// rather than assumed — the same way the font-scale policy is stamped
/// (`SigxFontScale`).
///
/// Mirrors the "host reads a `@objc public static var` off the module" pattern
/// `AppearanceModule.preferredStatusBarStyle` already established.
@objc public final class SigxOrientation: NSObject {

    /// Runtime override; `nil` means "use the configured default".
    private static var lockedMask: UIInterfaceOrientationMask?

    /// The mask the app was built with — the ceiling a runtime lock works
    /// within. Captured from the first `supportedMask(default:)` call so the
    /// stamped value is the single source of truth.
    private static var configuredMask: UIInterfaceOrientationMask?

    /// Called by the host's `AppDelegate`. `defaultMask` is stamped by the CLI
    /// from the app's configured `orientation`.
    @objc public static func supportedMask(default defaultMask: UIInterfaceOrientationMask)
        -> UIInterfaceOrientationMask {
        if configuredMask == nil { configuredMask = defaultMask }
        return lockedMask ?? defaultMask
    }

    /// The configured ceiling. Falls back to `Info.plist` when the host hasn't
    /// called `supportedMask(default:)` yet (custom hosts, very early calls).
    private static func ceiling() -> UIInterfaceOrientationMask {
        if let configured = configuredMask { return configured }
        return infoPlistMask()
    }

    private static func infoPlistMask() -> UIInterfaceOrientationMask {
        guard let names = Bundle.main.infoDictionary?["UISupportedInterfaceOrientations"]
            as? [String], !names.isEmpty else {
            return .allButUpsideDown
        }
        var mask: UIInterfaceOrientationMask = []
        for name in names {
            switch name {
            case "UIInterfaceOrientationPortrait": mask.insert(.portrait)
            case "UIInterfaceOrientationPortraitUpsideDown": mask.insert(.portraitUpsideDown)
            case "UIInterfaceOrientationLandscapeLeft": mask.insert(.landscapeLeft)
            case "UIInterfaceOrientationLandscapeRight": mask.insert(.landscapeRight)
            default: break
            }
        }
        return mask.isEmpty ? .allButUpsideDown : mask
    }

    private static func mask(for value: String) -> UIInterfaceOrientationMask? {
        switch value {
        case "portrait": return .portrait
        case "portrait-upside-down": return .portraitUpsideDown
        case "landscape": return .landscape
        // UIKit names landscape masks by where the HOME BUTTON ends up, which
        // is the opposite of the device-rotation direction. `landscape-left`
        // (device turned counter-clockwise) is `.landscapeRight` in UIKit terms.
        case "landscape-left": return .landscapeRight
        case "landscape-right": return .landscapeLeft
        case "all": return .all
        default: return nil
        }
    }

    /// `nil` on success, an error message otherwise — `DeviceInfoModule`
    /// hands it to JS as `{ error }` (CONVENTIONS.md C4).
    public static func lock(_ value: String) -> String? {
        guard let requested = mask(for: value) else {
            return "Unknown orientation '\(value)'."
        }
        let effective = requested.intersection(ceiling())
        if effective.isEmpty {
            return "The app is built with a fixed orientation, so lock('\(value)') "
                + "can't take effect. Set `orientation: 'default'` (or 'all') in "
                + "signalx.config.ts and re-run `sigx prebuild`."
        }
        lockedMask = effective
        apply(effective)
        return nil
    }

    /// Release the runtime lock, restoring the configured set.
    public static func unlock() -> String? {
        lockedMask = nil
        apply(ceiling())
        return nil
    }

    /// Tell UIKit the supported set changed, and — on iOS 16+ — rotate to it
    /// immediately. On iOS 15 the new mask is honored at the next physical
    /// rotation; forcing one needs `requestGeometryUpdate`, which is 16+, and
    /// the `UIDevice.setValue(forKey: "orientation")` trick is private API.
    private static func apply(_ mask: UIInterfaceOrientationMask) {
        DispatchQueue.main.async {
            guard let scene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState == .foregroundActive })
            else { return }

            if #available(iOS 16.0, *) {
                for window in scene.windows {
                    window.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
                }
                scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { _ in
                    // Errors here mean the system declined the rotation (e.g.
                    // the mask conflicts with the scene's own constraints).
                    // The mask is still updated, so the next physical rotation
                    // lands correctly — nothing actionable to report.
                }
            }
        }
    }
}
