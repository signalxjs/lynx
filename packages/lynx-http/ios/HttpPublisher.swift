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
        self.token = HttpEventBus.shared.addListener { [weak self] payload in
            guard let view = self?.lynxView else { return }
            // sendGlobalEvent expects an array of params; pass a single
            // dictionary as the only param — the JS shim reads the first
            // arg as `NativeHttpEvent`.
            view.sendGlobalEvent("__sigxHttpEvent", withParams: [payload])
        }
    }

    deinit {
        if let token = token {
            HttpEventBus.shared.removeListener(token)
        }
    }
}
