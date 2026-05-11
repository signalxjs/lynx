import Foundation
import Lynx

/// Per-LynxView publisher that bridges incoming deep links from
/// `LinkingState` into the LynxView's two native→JS channels:
///
/// 1. **`lynx.__globalProps.initialURL`** — set via
///    `LynxView.updateGlobalProps(withDictionary:)` so the JS bundle can read
///    the launch URL synchronously on first paint.
/// 2. **`urlReceived` global event** — fired via
///    `LynxView.sendGlobalEvent(_:withParams:)` so JS subscribers (via
///    `lynx.getJSModule("GlobalEventEmitter").addListener("urlReceived", …)`)
///    receive warm-start deep links.
///
/// Mirrors the dual-channel pattern from `@sigx/lynx-safe-area`'s
/// `SafeAreaPublisher`. One instance per LynxView; retained by the host.
final class LinkingPublisher {
    private weak var lynxView: LynxView?
    private var observer: NSObjectProtocol?

    init(lynxView: LynxView) {
        self.lynxView = lynxView

        // Cold-start case: the host AppDelegate has already forwarded the
        // launch URL into LinkingState before this LynxView existed. Seed
        // globalProps synchronously so the bundle's first sync read of
        // `lynx.__globalProps.initialURL` returns the URL.
        if let url = LinkingState.latestURL {
            lynxView.updateGlobalProps(with: ["initialURL": url])
        }

        // Warm-start case: subscribe to LinkingState's notification and
        // forward each new URL on both channels.
        observer = NotificationCenter.default.addObserver(
            forName: LinkingState.didReceiveURL,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard
                let view = self?.lynxView,
                let url = note.userInfo?["url"] as? String
            else { return }
            view.updateGlobalProps(with: ["initialURL": url])
            view.sendGlobalEvent("urlReceived", withParams: [url])
        }
    }

    deinit {
        if let observer = observer {
            NotificationCenter.default.removeObserver(observer)
        }
    }
}
