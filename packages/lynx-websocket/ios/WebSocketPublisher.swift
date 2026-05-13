import Foundation
import Lynx

/// Per-`LynxView` publisher that pumps `WebSocketEventBus` payloads into JS
/// via `LynxView.sendGlobalEvent("__sigxWebSocketEvent", [...])`.
///
/// One instance per LynxView; instantiated by the generated
/// `GeneratedLifecyclePublishers.attachAll(to:)` and retained for the
/// LynxView's lifetime. The bus is global so opening a socket from one
/// LynxView and reading it from another (via the JS shim) works, but in
/// practice each LynxView holds its own JS heap so events are delivered to
/// the matching view only.
final class WebSocketPublisher {

    private weak var lynxView: LynxView?
    private var token: UUID?

    init(lynxView: LynxView) {
        self.lynxView = lynxView
        self.token = WebSocketEventBus.shared.addListener { [weak self] payload in
            guard let view = self?.lynxView else { return }
            // sendGlobalEvent expects an array of params; pass a single
            // dictionary as the only param, matching what the JS shim
            // expects (it reads the first arg as `NativeEvent`).
            view.sendGlobalEvent("__sigxWebSocketEvent", withParams: [payload])
        }
    }

    deinit {
        if let token = token {
            WebSocketEventBus.shared.removeListener(token)
        }
    }
}
