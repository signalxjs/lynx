import Foundation
import UIKit
import Lynx

/// Per-LynxView publisher: pumps `UpdatesEventBus` payloads into JS
/// (`__sigxUpdatesEvent`), registers the view with `UpdateStore` so
/// `applyNow` has a reload target, and converts background→active app
/// transitions into `foreground` events for `checkOn: ['foreground']`.
/// Instantiated by the generated `GeneratedLifecyclePublishers.attachAll(to:)`.
final class UpdatesLifecyclePublisher {

    private weak var lynxView: LynxView?
    private var token: UUID?
    private var observers: [NSObjectProtocol] = []
    private var sawBackground = false

    init(lynxView: LynxView) {
        self.lynxView = lynxView
        UpdateStore.shared.attachView(lynxView)
        token = UpdatesEventBus.shared.addListener { [weak self] payload in
            guard let view = self?.lynxView else { return }
            view.sendGlobalEvent(UpdatesEventBus.channel, withParams: [payload])
        }

        // Foreground detection: only resume-after-background counts — cold
        // start is covered by the JS 'launch' trigger.
        let center = NotificationCenter.default
        observers.append(center.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.sawBackground = true
        })
        observers.append(center.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            guard let self, self.sawBackground else { return }
            self.sawBackground = false
            UpdatesEventBus.shared.emitForeground()
        })
    }

    deinit {
        if let token { UpdatesEventBus.shared.removeListener(token) }
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
    }
}
