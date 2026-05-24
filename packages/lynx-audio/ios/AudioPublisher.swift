import Foundation
import Lynx

/// Per-`LynxView` publisher that pumps `AudioEventBus` payloads into JS via
/// `LynxView.sendGlobalEvent(channel, withParams:)`. One instance per
/// LynxView; instantiated by the autolink-generated
/// `GeneratedLifecyclePublishers.attachAll(to:)` and retained for the
/// LynxView's lifetime.
final class AudioPublisher {

    private weak var lynxView: LynxView?
    private var token: UUID?

    init(lynxView: LynxView) {
        self.lynxView = lynxView
        self.token = AudioEventBus.shared.addListener { [weak self] channel, payload in
            guard let view = self?.lynxView else { return }
            view.sendGlobalEvent(channel, withParams: [payload])
        }
    }

    deinit {
        if let token = token {
            AudioEventBus.shared.removeListener(token)
        }
    }
}
