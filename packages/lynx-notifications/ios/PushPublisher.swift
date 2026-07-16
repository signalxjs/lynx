import Foundation
import Lynx

/// Per-`LynxView` publisher that pumps `PushEventBus` payloads into JS via
/// `LynxView.sendGlobalEvent(name, withParams:)`.
///
/// One instance per LynxView; instantiated by the generated
/// `GeneratedLifecyclePublishers.attachAll(to:)` and retained for the
/// LynxView's lifetime. The bus is global so a remote push or tap that fires
/// before the LynxView's JS heap is ready will be replayed (for `__sigxPushToken`)
/// or delivered on the next message via cold-start retrieval.
final class PushPublisher {

    private weak var lynxView: LynxView?
    private var token: UUID?

    init(lynxView: LynxView) {
        self.lynxView = lynxView
        self.token = PushEventBus.shared.addListener { [weak self] channel, json in
            guard let view = self?.lynxView else { return }
            // A single JSON string as the only param — a structured map loses
            // its sibling scalars crossing Lynx 0.5.0's bridge (#342, see
            // `PushEventBus.emit`). The JS shim parses the first arg.
            view.sendGlobalEvent(channel, withParams: [json])
        }
    }

    deinit {
        if let token = token {
            PushEventBus.shared.removeListener(token)
        }
    }
}
