import Foundation
import Lynx

/// Per-`LynxView` publisher that pumps `WebRTCEventBus` payloads into JS
/// via `LynxView.sendGlobalEvent("__sigxWebRTCEvent", [...])`.
///
/// One instance per LynxView; instantiated by the generated
/// `GeneratedLifecyclePublishers.attachAll(to:)` and retained for the
/// LynxView's lifetime.
final class WebRTCPublisher {

    private weak var lynxView: LynxView?
    private var token: UUID?

    init(lynxView: LynxView) {
        self.lynxView = lynxView
        self.token = WebRTCEventBus.shared.addListener { [weak self] json in
            guard let view = self?.lynxView else { return }
            // Pass a single JSON string as the only param — the JS shim
            // parses string events. A string survives Lynx 0.5.0's bridge
            // marshalling intact where a structured map carrying a nested
            // map (e.g. `candidate`) does not (#342).
            view.sendGlobalEvent("__sigxWebRTCEvent", withParams: [json])
        }
    }

    deinit {
        if let token = token {
            WebRTCEventBus.shared.removeListener(token)
        }
    }
}
