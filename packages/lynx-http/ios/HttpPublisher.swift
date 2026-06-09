import Foundation
import Lynx

/// Per-`LynxView` publisher that pumps `HttpEventBus` payloads into JS via
/// `LynxView.sendGlobalEvent("__sigxHttpEvent", [...])`.
///
/// One instance per LynxView; instantiated by the generated
/// `GeneratedLifecyclePublishers.attachAll(to:)` and retained for the
/// LynxView's lifetime — same wiring as `WebSocketPublisher`.
final class HttpPublisher {

    private weak var lynxView: LynxView?
    private var token: UUID?

    init(lynxView: LynxView) {
        self.lynxView = lynxView
        self.token = HttpEventBus.shared.addListener { [weak self] json in
            guard let view = self?.lynxView else { return }
            // sendGlobalEvent expects an array of params; pass a single JSON
            // string as the only param — the JS shim parses the first arg as
            // `NativeHttpEvent`. A string (rather than a structured map)
            // survives Lynx 0.5.0's bridge marshalling intact (see #342 /
            // `HttpEventBus.emit`).
            view.sendGlobalEvent("__sigxHttpEvent", withParams: [json])
        }
    }

    deinit {
        if let token = token {
            HttpEventBus.shared.removeListener(token)
        }
    }
}
