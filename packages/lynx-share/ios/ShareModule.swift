import UIKit
import Lynx

/// Native share dialog module.
/// JS usage: NativeModules.Share.share({ title: "Check this", text: "Hello!", url: "https://..." })
class ShareModule: NSObject, LynxModule {

    @objc static var name: String { "Share" }

    @objc static var methodLookup: [String: String] {
        [
            "share": NSStringFromSelector(#selector(share(_:))),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    @objc func share(_ options: [String: Any]?) {
        guard let options = options else { return }

        let title = options["title"] as? String
        let text = options["text"] as? String
        let urlString = options["url"] as? String

        var items: [Any] = []
        if let text = text { items.append(text) }
        if let urlString = urlString, let url = URL(string: urlString) {
            items.append(url)
        }

        guard !items.isEmpty else { return }

        DispatchQueue.main.async {
            let activityVC = UIActivityViewController(activityItems: items, applicationActivities: nil)
            activityVC.setValue(title, forKey: "subject")

            if let popover = activityVC.popoverPresentationController {
                popover.sourceView = UIApplication.shared.windows.first?.rootViewController?.view
                popover.sourceRect = CGRect(x: UIScreen.main.bounds.midX, y: UIScreen.main.bounds.midY, width: 0, height: 0)
                popover.permittedArrowDirections = []
            }

            UIApplication.shared.windows.first?.rootViewController?.present(activityVC, animated: true)
        }
    }
}
