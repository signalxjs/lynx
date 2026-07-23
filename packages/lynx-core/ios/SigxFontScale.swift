import UIKit

/// App-level policy for how the OS text-size setting maps onto the Lynx
/// engine's font scale. Stamped from `signalx.config.ts` (`fontScale: {…}`)
/// by the managed `LynxSetupService.initialize()` before any LynxView exists.
struct SigxFontScalePolicy {
    /// Follow the OS setting. `false` pins the effective scale to 1.0.
    var follow: Bool = true
    /// Lower clamp on the applied scale.
    var min: CGFloat = 0.5
    /// Upper clamp on the applied scale.
    var max: CGFloat = 2.0
}

/// Derives the effective Lynx `fontScale` from Dynamic Type.
///
/// The OS value is read through `UIFontMetrics(.body)` rather than a content-
/// size-category table so the scale tracks Apple's real (non-linear) curve,
/// including the accessibility sizes (~3.1× at AX-XXXL).
enum SigxFontScale {
    /// Set once at startup by the managed `LynxSetupService`; read by the
    /// host's LynxView builder and by `FontScalePublisher`.
    static var policy = SigxFontScalePolicy()

    /// Raw OS scale (1.0 at the default "Large" setting), unclamped.
    static func osScale(for traits: UITraitCollection? = nil) -> CGFloat {
        let metrics = UIFontMetrics(forTextStyle: .body)
        // 17pt is the .body base size at the default content size category.
        let scaled = traits.map { metrics.scaledValue(for: 17, compatibleWith: $0) }
            ?? metrics.scaledValue(for: 17)
        // Round to 3 decimals so dedupe comparisons are stable.
        return (scaled / 17 * 1000).rounded() / 1000
    }

    /// OS scale with the app policy applied — what the engine receives.
    static func effectiveScale(for traits: UITraitCollection? = nil) -> CGFloat {
        guard policy.follow else { return 1.0 }
        return Swift.min(Swift.max(osScale(for: traits), policy.min), policy.max)
    }
}
