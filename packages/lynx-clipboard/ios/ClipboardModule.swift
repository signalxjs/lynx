import UIKit
import Lynx

/// Native clipboard access module.
/// JS usage: NativeModules.Clipboard.setString("hello")
class ClipboardModule: NSObject, LynxModule {

    @objc static var name: String { "Clipboard" }

    @objc static var methodLookup: [String: String] {
        [
            "setString": NSStringFromSelector(#selector(setString(_:))),
            "getString": NSStringFromSelector(#selector(getString(_:))),
            "hasString": NSStringFromSelector(#selector(hasString(_:))),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    @objc func setString(_ text: String?) {
        UIPasteboard.general.string = text ?? ""
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
