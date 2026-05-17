import UIKit
import PhotosUI
import Lynx

/// Image picker module for selecting images/videos from gallery.
/// JS usage: NativeModules.ImagePicker.pickImage({ quality: 0.8 }, callback)
class ImagePickerModule: NSObject, LynxModule, PHPickerViewControllerDelegate {

    @objc static var name: String { "ImagePicker" }

    @objc static var methodLookup: [String: String] {
        [
            "pickImage": NSStringFromSelector(#selector(pickImage(_:callback:))),
            "pickVideo": NSStringFromSelector(#selector(pickVideo(_:callback:))),
            "requestPermission": NSStringFromSelector(#selector(requestPermission(_:))),
            "getPermissionStatus": NSStringFromSelector(#selector(getPermissionStatus(_:))),
        ]
    }

    private var pendingCallback: LynxCallbackBlock?

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    @objc func pickImage(_ options: [String: Any]?, callback: LynxCallbackBlock?) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.pendingCallback = callback

            let selectionLimit = options?["selectionLimit"] as? Int ?? 1

            var config = PHPickerConfiguration()
            config.selectionLimit = selectionLimit
            config.filter = .images

            let picker = PHPickerViewController(configuration: config)
            picker.delegate = self
            UIApplication.shared.windows.first?.rootViewController?.present(picker, animated: true)
        }
    }

    @objc func pickVideo(_ options: [String: Any]?, callback: LynxCallbackBlock?) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.pendingCallback = callback

            var config = PHPickerConfiguration()
            config.selectionLimit = 1
            config.filter = .videos

            let picker = PHPickerViewController(configuration: config)
            picker.delegate = self
            UIApplication.shared.windows.first?.rootViewController?.present(picker, animated: true)
        }
    }

    @objc func requestPermission(_ callback: LynxCallbackBlock?) {
        callback?(["status": "granted"])
    }

    @objc func getPermissionStatus(_ callback: LynxCallbackBlock?) {
        callback?(["status": "granted"])
    }

    // MARK: - PHPickerViewControllerDelegate

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)

        guard !results.isEmpty else {
            pendingCallback?(["cancelled": true, "assets": []])
            pendingCallback = nil
            return
        }

        var assets: [[String: Any]] = []
        let group = DispatchGroup()

        for result in results {
            let provider = result.itemProvider

            if provider.canLoadObject(ofClass: UIImage.self) {
                group.enter()
                provider.loadObject(ofClass: UIImage.self) { reading, error in
                    defer { group.leave() }

                    guard let image = reading as? UIImage else { return }

                    let quality: CGFloat = 0.8
                    guard let data = image.jpegData(compressionQuality: quality) else { return }

                    let fileName = "pick_\(UUID().uuidString).jpg"
                    let tempPath = NSTemporaryDirectory() + fileName

                    do {
                        try data.write(to: URL(fileURLWithPath: tempPath))
                        let asset: [String: Any] = [
                            // `file://` scheme — Lynx's `<image>` loader
                            // needs a scheme on the URI; a bare filesystem
                            // path silently fails to render.
                            "uri": "file://" + tempPath,
                            "width": Int(image.size.width),
                            "height": Int(image.size.height),
                            "fileSize": data.count,
                            "type": "image",
                        ]
                        assets.append(asset)
                    } catch {
                        // Skip failed items
                    }
                }
            }
        }

        group.notify(queue: .main) { [weak self] in
            self?.pendingCallback?(["cancelled": false, "assets": assets])
            self?.pendingCallback = nil
        }
    }
}
