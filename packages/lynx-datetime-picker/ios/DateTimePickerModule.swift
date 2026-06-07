import UIKit
import Lynx

/// Native date/time picker module — wraps `UIDatePicker` in a presented
/// sheet with Cancel/Done, since `UIDatePicker` is a view, not a view
/// controller.
///
/// JS usage: `NativeModules.DateTimePicker.present(options, callback)`.
/// All instants cross the bridge as epoch milliseconds.
class DateTimePickerModule: NSObject, LynxModule {

    @objc static var name: String { "DateTimePicker" }

    @objc static var methodLookup: [String: String] {
        [
            "present": NSStringFromSelector(#selector(present(_:callback:))),
        ]
    }

    private var pendingCallback: LynxCallbackBlock?
    private weak var presentedSheet: DateTimePickerSheetController?

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    @objc func present(_ options: [String: Any]?, callback: LynxCallbackBlock?) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            // A new pick supersedes any in-flight one — resolve it as
            // cancelled and dismiss its sheet so no dead UI lingers.
            self.pendingCallback?(["cancelled": true])
            self.pendingCallback = nil
            if let stale = self.presentedSheet {
                stale.onFinish = nil
                stale.dismiss(animated: false)
                self.presentedSheet = nil
            }
            guard let host = SigxPresentation.topPresenter() else {
                callback?(["cancelled": true])
                return
            }
            self.pendingCallback = callback

            let sheet = DateTimePickerSheetController(options: options)
            sheet.onFinish = { [weak self] date in
                guard let self = self else { return }
                self.presentedSheet = nil
                guard let cb = self.pendingCallback else { return }
                self.pendingCallback = nil // guard against double-fire
                if let date = date {
                    cb([
                        "cancelled": false,
                        "value": Int(date.timeIntervalSince1970 * 1000),
                    ])
                } else {
                    cb(["cancelled": true])
                }
            }
            self.presentedSheet = sheet
            host.present(sheet, animated: true)
        }
    }
}

/// Bottom-sheet-style container: Cancel/Done toolbar above a wheel-style
/// `UIDatePicker`. Swipe-to-dismiss counts as cancel.
private class DateTimePickerSheetController: UIViewController,
    UIAdaptivePresentationControllerDelegate {

    /// Called exactly once — with the picked date, or `nil` on cancel.
    var onFinish: ((Date?) -> Void)?

    private let picker = UIDatePicker()

    init(options: [String: Any]?) {
        super.init(nibName: nil, bundle: nil)

        let mode = options?["mode"] as? String
        switch mode {
        case "time": picker.datePickerMode = .time
        case "datetime": picker.datePickerMode = .dateAndTime
        default: picker.datePickerMode = .date
        }
        // Wheels render predictably inside a presented sheet on iOS 14+;
        // .inline/.compact expect an anchored layout we don't have here.
        picker.preferredDatePickerStyle = .wheels

        // Epoch-ms options arrive as NSNumber from the bridge — go through
        // doubleValue rather than `as? Double` so integral values survive.
        if let ms = (options?["value"] as? NSNumber)?.doubleValue {
            picker.date = Date(timeIntervalSince1970: ms / 1000)
        }
        if mode != "time" {
            // The JS contract documents min/max as ignored in time mode.
            if let ms = (options?["minimumDate"] as? NSNumber)?.doubleValue {
                picker.minimumDate = Date(timeIntervalSince1970: ms / 1000)
            }
            if let ms = (options?["maximumDate"] as? NSNumber)?.doubleValue {
                picker.maximumDate = Date(timeIntervalSince1970: ms / 1000)
            }
        }
        // UIDatePicker supports 1–30 and only values that evenly divide 60;
        // anything else asserts at runtime.
        if let interval = (options?["minuteInterval"] as? NSNumber)?.intValue,
            (1...30).contains(interval), 60 % interval == 0 {
            picker.minuteInterval = interval
        }
        if let is24Hour = options?["is24Hour"] as? Bool {
            // UIDatePicker has no 24h switch — the locale decides. Override
            // only the hour cycle via the BCP-47 `hc` extension so the
            // user's month/day names and calendar stay localized.
            let base = Locale.current.identifier
                .split(separator: "@").first.map(String.init)?
                .replacingOccurrences(of: "_", with: "-") ?? "en-US"
            picker.locale = Locale(identifier: "\(base)-u-hc-\(is24Hour ? "h23" : "h12")")
        }
        if let title = options?["title"] as? String {
            self.title = title
        }

        // .pageSheet participates in the iOS 15+ detent system (bottom
        // sheet); .formSheet would center on iPad and ignore detents.
        modalPresentationStyle = .pageSheet
        if #available(iOS 15.0, *) {
            sheetPresentationController?.detents = [.medium()]
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        presentationController?.delegate = self

        let cancel = UIBarButtonItem(
            barButtonSystemItem: .cancel, target: self, action: #selector(didCancel),
        )
        let done = UIBarButtonItem(
            barButtonSystemItem: .done, target: self, action: #selector(didConfirm),
        )
        let titleItem = UIBarButtonItem(title: title, style: .plain, target: nil, action: nil)
        titleItem.isEnabled = false

        let toolbar = UIToolbar()
        toolbar.items = [
            cancel,
            UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil),
            titleItem,
            UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil),
            done,
        ]

        toolbar.translatesAutoresizingMaskIntoConstraints = false
        picker.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(toolbar)
        view.addSubview(picker)
        NSLayoutConstraint.activate([
            toolbar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            toolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            toolbar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            picker.topAnchor.constraint(equalTo: toolbar.bottomAnchor),
            picker.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            picker.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            picker.bottomAnchor.constraint(
                lessThanOrEqualTo: view.safeAreaLayoutGuide.bottomAnchor,
            ),
        ])
    }

    @objc private func didConfirm() {
        finish(with: picker.date)
    }

    @objc private func didCancel() {
        finish(with: nil)
    }

    /// Swipe-to-dismiss — already gone, just report cancel.
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        onFinish?(nil)
        onFinish = nil
    }

    private func finish(with date: Date?) {
        onFinish?(date)
        onFinish = nil
        dismiss(animated: true)
    }
}
