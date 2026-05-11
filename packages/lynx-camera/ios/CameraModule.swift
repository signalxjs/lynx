import UIKit
import AVFoundation
import Lynx

/// Camera capture module.
/// JS usage: NativeModules.Camera.takePicture({ quality: 0.8 }, callback)
class CameraModule: NSObject, LynxModule, UIImagePickerControllerDelegate, UINavigationControllerDelegate {

    @objc static var name: String { "Camera" }

    @objc static var methodLookup: [String: String] {
        [
            "takePicture": NSStringFromSelector(#selector(takePicture(_:callback:))),
            "requestPermission": NSStringFromSelector(#selector(requestPermission(_:))),
            "getPermissionStatus": NSStringFromSelector(#selector(getPermissionStatus(_:))),
        ]
    }

    private var pendingCallback: LynxCallbackBlock?

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    @objc func takePicture(_ options: [String: Any]?, callback: LynxCallbackBlock?) {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            callback?(["error": "Camera not available on this device"])
            return
        }

        let status = AVCaptureDevice.authorizationStatus(for: .video)
        guard status == .authorized else {
            if status == .notDetermined {
                AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                    if granted {
                        self?.presentCamera(options: options, callback: callback)
                    } else {
                        callback?(["error": "Camera permission denied"])
                    }
                }
                return
            }
            callback?(["error": "Camera permission not granted"])
            return
        }

        presentCamera(options: options, callback: callback)
    }

    @objc func requestPermission(_ callback: LynxCallbackBlock?) {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        if status == .notDetermined {
            AVCaptureDevice.requestAccess(for: .video) { granted in
                callback?(["status": granted ? "granted" : "denied"])
            }
        } else {
            callback?(["status": permissionString(for: status)])
        }
    }

    @objc func getPermissionStatus(_ callback: LynxCallbackBlock?) {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        callback?(["status": permissionString(for: status)])
    }

    private func presentCamera(options: [String: Any]?, callback: LynxCallbackBlock?) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.pendingCallback = callback

            let picker = UIImagePickerController()
            picker.sourceType = .camera
            picker.delegate = self
            picker.allowsEditing = false

            UIApplication.shared.windows.first?.rootViewController?.present(picker, animated: true)
        }
    }

    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        picker.dismiss(animated: true)

        guard let image = info[.originalImage] as? UIImage else {
            pendingCallback?(["error": "Failed to capture image"])
            pendingCallback = nil
            return
        }

        let quality: CGFloat = 0.8
        guard let data = image.jpegData(compressionQuality: quality) else {
            pendingCallback?(["error": "Failed to compress image"])
            pendingCallback = nil
            return
        }

        let fileName = "camera_\(UUID().uuidString).jpg"
        let tempPath = NSTemporaryDirectory() + fileName
        do {
            try data.write(to: URL(fileURLWithPath: tempPath))
            let result: [String: Any] = [
                "uri": tempPath,
                "width": Int(image.size.width),
                "height": Int(image.size.height),
                "fileSize": data.count,
            ]
            pendingCallback?(result)
        } catch {
            pendingCallback?(["error": error.localizedDescription])
        }
        pendingCallback = nil
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        pendingCallback?(["cancelled": true])
        pendingCallback = nil
    }

    private func permissionString(for status: AVAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "undetermined"
        case .restricted:    return "restricted"
        case .denied:        return "denied"
        case .authorized:    return "granted"
        @unknown default:    return "unknown"
        }
    }
}
