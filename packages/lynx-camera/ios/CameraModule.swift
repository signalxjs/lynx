import UIKit
import AVFoundation
import Lynx

/// Camera capture module.
/// JS usage: NativeModules.Camera.takePicture({ quality: 0.8 }, callback)
///           NativeModules.Camera.recordVideo({ maxDurationMs: 30000 }, callback)
class CameraModule: NSObject, LynxModule, UIImagePickerControllerDelegate, UINavigationControllerDelegate {

    @objc static var name: String { "Camera" }

    @objc static var methodLookup: [String: String] {
        [
            "takePicture": NSStringFromSelector(#selector(takePicture(_:callback:))),
            "recordVideo": NSStringFromSelector(#selector(recordVideo(_:callback:))),
            "requestPermission": NSStringFromSelector(#selector(requestPermission(_:))),
            "getPermissionStatus": NSStringFromSelector(#selector(getPermissionStatus(_:))),
        ]
    }

    private var pendingCallback: LynxCallbackBlock?
    /// JPEG compression quality for the next photo capture, taken from
    /// `CameraOptions.quality` (defaults to 0.8). `maxWidth`/`maxHeight` are not
    /// yet applied.
    private var pendingPhotoQuality: CGFloat = 0.8

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    @objc func takePicture(_ options: [String: Any]?, callback: LynxCallbackBlock?) {
        capture(options: options, video: false, callback: callback)
    }

    @objc func recordVideo(_ options: [String: Any]?, callback: LynxCallbackBlock?) {
        capture(options: options, video: true, callback: callback)
    }

    /// Shared entry for photo (`takePicture`) and video (`recordVideo`):
    /// availability + permission gate, then present the camera in the right mode.
    private func capture(options: [String: Any]?, video: Bool, callback: LynxCallbackBlock?) {
        // Fail fast if a capture is already in flight — the picker is modal, so
        // a second present would clobber `pendingCallback` and orphan the first
        // Promise.
        guard pendingCallback == nil else {
            callback?(["error": "A capture is already in progress"])
            return
        }

        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            callback?(["error": "Camera not available on this device"])
            return
        }

        let status = AVCaptureDevice.authorizationStatus(for: .video)
        guard status == .authorized else {
            if status == .notDetermined {
                AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                    if granted {
                        self?.presentCamera(options: options, video: video, callback: callback)
                    } else {
                        callback?(["error": "Camera permission denied"])
                    }
                }
                return
            }
            callback?(["error": "Camera permission not granted"])
            return
        }

        presentCamera(options: options, video: video, callback: callback)
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

    private func presentCamera(options: [String: Any]?, video: Bool, callback: LynxCallbackBlock?) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.pendingCallback = callback
            if let q = (options?["quality"] as? NSNumber)?.doubleValue, q >= 0, q <= 1 {
                self.pendingPhotoQuality = CGFloat(q)
            } else {
                self.pendingPhotoQuality = 0.8
            }

            let picker = UIImagePickerController()
            picker.sourceType = .camera
            picker.delegate = self
            picker.allowsEditing = false

            if video {
                picker.mediaTypes = ["public.movie"]
                picker.cameraCaptureMode = .video
                if let ms = (options?["maxDurationMs"] as? NSNumber)?.doubleValue, ms > 0 {
                    picker.videoMaximumDuration = ms / 1000.0
                }
            }

            if let facing = options?["facing"] as? String {
                let device: UIImagePickerController.CameraDevice = facing == "front" ? .front : .rear
                if UIImagePickerController.isCameraDeviceAvailable(device) {
                    picker.cameraDevice = device
                }
            }

            guard let presenter = self.topViewController() else {
                // No window/VC to present from — resolve so the JS Promise
                // never hangs.
                self.pendingCallback?(["error": "No view controller available to present the camera"])
                self.pendingCallback = nil
                return
            }
            presenter.present(picker, animated: true)
        }
    }

    /// Multi-scene-safe lookup of the front-most view controller to present
    /// from. `UIApplication.windows.first` is unreliable: the first window
    /// isn't necessarily the key/active one, and presenting on the wrong window
    /// silently no-ops (leaving the JS Promise unresolved).
    private func topViewController() -> UIViewController? {
        let windows = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
        let keyWindow = windows.first { $0.isKeyWindow } ?? windows.first
        var top = keyWindow?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }

    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        picker.dismiss(animated: true)

        // Video capture: the recorded clip arrives as a temp file URL.
        if let mediaURL = info[.mediaURL] as? URL {
            handleVideo(at: mediaURL)
            return
        }

        guard let image = info[.originalImage] as? UIImage else {
            pendingCallback?(["error": "Failed to capture image"])
            pendingCallback = nil
            return
        }

        guard let data = image.jpegData(compressionQuality: pendingPhotoQuality) else {
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

    /// Move the picker's temp clip somewhere stable and report duration /
    /// dimensions / size. The URL handed to us may be cleared once the picker
    /// is torn down, so we relocate it before returning. The file move and the
    /// synchronous `AVURLAsset` metadata reads run off the main thread (this
    /// delegate fires on the main runloop) so a large recording doesn't jank
    /// the UI; the callback hops back to main.
    private func handleVideo(at sourceURL: URL) {
        let callback = pendingCallback
        pendingCallback = nil
        DispatchQueue.global(qos: .userInitiated).async {
            let fileName = "camera_\(UUID().uuidString).mov"
            let destPath = NSTemporaryDirectory() + fileName
            let destURL = URL(fileURLWithPath: destPath)
            func finish(_ result: [String: Any]) {
                DispatchQueue.main.async { callback?(result) }
            }
            do {
                if FileManager.default.fileExists(atPath: destPath) {
                    try FileManager.default.removeItem(at: destURL)
                }
                // The picker's temp clip is ours to consume — move it (cheap,
                // same filesystem) rather than copying, which would double I/O
                // and storage for large recordings. Fall back to a copy if the
                // move fails (e.g. cross-volume).
                do {
                    try FileManager.default.moveItem(at: sourceURL, to: destURL)
                } catch {
                    try FileManager.default.copyItem(at: sourceURL, to: destURL)
                }
            } catch {
                finish(["error": error.localizedDescription])
                return
            }

            var result: [String: Any] = ["uri": destPath]
            let asset = AVURLAsset(url: destURL)
            let durationSeconds = CMTimeGetSeconds(asset.duration)
            if durationSeconds.isFinite && durationSeconds > 0 {
                result["durationMs"] = Int(durationSeconds * 1000)
            }
            if let track = asset.tracks(withMediaType: .video).first {
                let size = track.naturalSize.applying(track.preferredTransform)
                result["width"] = Int(abs(size.width))
                result["height"] = Int(abs(size.height))
            }
            if let attrs = try? FileManager.default.attributesOfItem(atPath: destPath),
               let bytes = (attrs[.size] as? NSNumber)?.intValue {
                result["fileSize"] = bytes
            }
            finish(result)
        }
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
