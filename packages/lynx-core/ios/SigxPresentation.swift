import UIKit

/// Shared presentation helpers for sigx-lynx native modules.
public enum SigxPresentation {
    /// Top-most presenter on the active scene's key window. Multi-scene safe
    /// (only considers `foregroundActive` scenes) and walks the
    /// `presentedViewController` chain so presenting over an existing modal
    /// doesn't throw "already presenting".
    public static func topPresenter() -> UIViewController? {
        var root: UIViewController? = nil
        for scene in UIApplication.shared.connectedScenes {
            guard scene.activationState == .foregroundActive,
                  let windowScene = scene as? UIWindowScene else { continue }
            let window = windowScene.windows.first { $0.isKeyWindow } ?? windowScene.windows.first
            if let candidate = window?.rootViewController {
                root = candidate
                break
            }
        }
        var top = root ?? UIApplication.shared.windows.first?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
}
