import UIKit
import UniformTypeIdentifiers
import Lynx

/// Generic file picker module — pick any file via the system document picker.
/// JS usage: NativeModules.FilePicker.pick({ multiple: true, types: ["application/pdf"] }, callback)
///
/// Uses `UIDocumentPickerViewController(forOpeningContentTypes:asCopy:true)`:
/// `asCopy` hands back an app-owned temporary copy, so no security-scoped
/// resource bookkeeping is needed and no Info.plist usage description applies.
class FilePickerModule: NSObject, LynxModule, UIDocumentPickerDelegate {

    @objc static var name: String { "FilePicker" }

    @objc static var methodLookup: [String: String] {
        [
            "pick": NSStringFromSelector(#selector(pick(_:callback:))),
        ]
    }

    private var pendingCallback: LynxCallbackBlock?
    private var copyToCache = true

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    @objc func pick(_ options: [String: Any]?, callback: LynxCallbackBlock?) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            // Fail fast when nothing can present (multi-scene edge cases) —
            // never leave the JS Promise hanging on an invisible picker.
            guard let presenter = SigxPresentation.topPresenter() else {
                callback?(["cancelled": true, "assets": [], "error": "no presenter available"])
                return
            }
            // Pre-empt any prior in-flight pick so its Promise can't hang
            // (mirrors the Android MediaCapture pre-emption behavior).
            self.pendingCallback?(["cancelled": true, "assets": []])
            self.pendingCallback = callback
            self.copyToCache = options?["copyToCache"] as? Bool ?? true

            let multiple = options?["multiple"] as? Bool ?? false
            let mimeTypes = options?["types"] as? [String] ?? []

            let picker = UIDocumentPickerViewController(
                forOpeningContentTypes: Self.contentTypes(forMimeTypes: mimeTypes),
                asCopy: true
            )
            picker.allowsMultipleSelection = multiple
            picker.delegate = self
            presenter.present(picker, animated: true)
        }
    }

    /// Map JS-side MIME filters to UTTypes. Wildcard families map to their
    /// base UTType; unknown MIME strings are skipped. Empty/unmappable input
    /// falls back to `[.item]` ("any file") so the picker always opens.
    private static func contentTypes(forMimeTypes mimeTypes: [String]) -> [UTType] {
        var out: [UTType] = []
        for mime in mimeTypes {
            switch mime {
            case "*/*": return [.item]
            case "image/*": out.append(.image)
            case "video/*": out.append(.movie)
            case "audio/*": out.append(.audio)
            case "text/*": out.append(.text)
            default:
                if let ut = UTType(mimeType: mime) { out.append(ut) }
            }
        }
        return out.isEmpty ? [.item] : out
    }

    // MARK: - UIDocumentPickerDelegate

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        controller.dismiss(animated: true)
        let callback = pendingCallback
        pendingCallback = nil
        let copyToCache = self.copyToCache

        // Copying + attribute reads can be slow for large/multi-select picks —
        // do the filesystem work off the main thread and hop back to deliver.
        DispatchQueue.global(qos: .userInitiated).async {
            var assets: [[String: Any]] = []
            for url in urls {
                // `asCopy: true` placed an app-owned copy in tmp. Persist it into
                // Documents/picked so the URI survives app restarts (tmp can be
                // purged by iOS at any time) — same convention as image-picker.
                var fileURL = url
                if copyToCache {
                    let docsDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
                        ?? URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
                    let pickedDir = docsDir.appendingPathComponent("picked", isDirectory: true)
                    try? FileManager.default.createDirectory(at: pickedDir, withIntermediateDirectories: true)
                    let dest = pickedDir.appendingPathComponent("pick_\(UUID().uuidString)_\(url.lastPathComponent)")
                    do {
                        try FileManager.default.copyItem(at: url, to: dest)
                        fileURL = dest
                    } catch {
                        // Fall back to the tmp copy rather than dropping the asset.
                    }
                }

                let attrs = try? FileManager.default.attributesOfItem(atPath: fileURL.path)
                let size = (attrs?[.size] as? UInt64) ?? 0
                let mime = UTType(filenameExtension: fileURL.pathExtension)?.preferredMIMEType
                    ?? "application/octet-stream"
                assets.append([
                    // `file://` scheme included — bare paths silently fail in
                    // Lynx loaders and FileSystem expects a resolvable path.
                    "uri": fileURL.absoluteString,
                    "name": url.lastPathComponent,
                    "mimeType": mime,
                    "size": size,
                ])
            }
            DispatchQueue.main.async {
                callback?(["cancelled": false, "assets": assets])
            }
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        controller.dismiss(animated: true)
        pendingCallback?(["cancelled": true, "assets": []])
        pendingCallback = nil
    }
}
