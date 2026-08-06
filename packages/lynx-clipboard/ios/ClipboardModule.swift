import UIKit
import Lynx

/// Native clipboard access module.
/// JS usage: NativeModules.Clipboard.setString("hello")
class ClipboardModule: NSObject, LynxModule {

    @objc static var name: String { "Clipboard" }

    @objc static var methodLookup: [String: String] {
        [
            "setString": NSStringFromSelector(#selector(setString(_:callback:))),
            "getString": NSStringFromSelector(#selector(getString(_:))),
            "hasString": NSStringFromSelector(#selector(hasString(_:))),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    /// Writes to the pasteboard and reports the outcome.
    ///
    /// The callback exists for symmetry with Android, where `setPrimaryClip`
    /// genuinely can throw (a clip over the binder transaction limit). Nothing
    /// here can fail, so this always reports success — but a caller awaiting
    /// `setString` must get an answer on both platforms, or the promise hangs
    /// on iOS.
    @objc func setString(_ text: String?, callback: LynxCallbackBlock?) {
        UIPasteboard.general.string = text ?? ""
        callback?([:])
    }

    @objc func getString(_ callback: LynxCallbackBlock?) {
        let text = UIPasteboard.general.string ?? ""
        callback?(text)
    }

    @objc func hasString(_ callback: LynxCallbackBlock?) {
        let has = UIPasteboard.general.hasStrings
        callback?(has)
    }
}
