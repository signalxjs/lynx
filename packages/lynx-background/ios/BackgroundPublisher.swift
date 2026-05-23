import Foundation
import Lynx

/// Per-`LynxView` publisher that pumps `BackgroundEventBus` payloads into JS
/// via `LynxView.sendGlobalEvent(name, withParams:)`.
///
/// One instance per LynxView; instantiated by the generated
/// `GeneratedLifecyclePublishers.attachAll(to:)` and retained for the
/// LynxView's lifetime. The bus is global so a BGTask that fires before the
/// LynxView's JS heap is ready will queue under its `runId`; the JS shim
/// completes such a fire as `success: false` after the bounded grace period.
final class BackgroundPublisher {

    private weak var lynxView: LynxView?
    private var token: UUID?

    init(lynxView: LynxView) {
        self.lynxView = lynxView
        self.token = BackgroundEventBus.shared.addListener { [weak self] channel, payload in
            guard let view = self?.lynxView else { return }
            view.sendGlobalEvent(channel, withParams: [payload])
        }
    }

    deinit {
        if let token = token {
            BackgroundEventBus.shared.removeListener(token)
        }
    }
}
