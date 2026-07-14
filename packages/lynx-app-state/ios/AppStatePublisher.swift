import Foundation
import UIKit
import Lynx

/// Per-LynxView publisher: converts UIApplication foreground/background
/// notifications into `appStateChanged` global events for the JS side
/// (`@sigx/lynx-app-state`). Instantiated by the generated
/// `GeneratedLifecyclePublishers.attachAll(to:)`.
///
/// Two-state model: only `didEnterBackgroundNotification` counts as
/// `background` — the transient `willResignActive` phase (control-center
/// pull, incoming call) is deliberately ignored so brief interruptions don't
/// flap JS listeners. `didBecomeActiveNotification` maps to `active`; the JS
/// layer dedups the cold-start firing (it already defaults to `active`).
final class AppStatePublisher {

    private static let eventName = "appStateChanged"

    private weak var lynxView: LynxView?
    private var observers: [NSObjectProtocol] = []

    init(lynxView: LynxView) {
        self.lynxView = lynxView

        let center = NotificationCenter.default
        observers.append(center.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.publish("active")
        })
        observers.append(center.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.publish("background")
        })
    }

    deinit {
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    private func publish(_ state: String) {
        guard let view = lynxView else { return }
        view.sendGlobalEvent(Self.eventName, withParams: [["state": state]])
    }
}
