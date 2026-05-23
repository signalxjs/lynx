import Foundation
import AVFoundation
import Lynx

/// Audio recording + playback bridge.
///
/// JS usage (via the `@sigx/lynx-audio` shim, not directly):
///
///   NativeModules.Audio.play(uri, opts, cb)
///   NativeModules.Audio.pausePlayer(id, cb)
///   NativeModules.Audio.startRecording(opts, cb)
///   ...
///
/// State lives in `AudioPlayerRegistry` / `AudioRecorderRegistry`. The
/// module class is a thin dispatcher — Lynx allocates a fresh instance
/// per call so it intentionally holds no per-handle state itself.
/// Async events (`onEnd`, `onMeter`) flow through `AudioEventBus`.
@objc class AudioModule: NSObject, LynxModule {

    @objc static var name: String { "Audio" }

    @objc static var methodLookup: [String: String] {
        [
            "play":               NSStringFromSelector(#selector(play(_:options:callback:))),
            "preload":            NSStringFromSelector(#selector(preload(_:callback:))),
            "pausePlayer":        NSStringFromSelector(#selector(pausePlayer(_:callback:))),
            "resumePlayer":       NSStringFromSelector(#selector(resumePlayer(_:callback:))),
            "stopPlayer":         NSStringFromSelector(#selector(stopPlayer(_:callback:))),
            "seekPlayer":         NSStringFromSelector(#selector(seekPlayer(_:seconds:callback:))),
            "setPlayerVolume":    NSStringFromSelector(#selector(setPlayerVolume(_:volume:callback:))),
            "getPlayerStatus":    NSStringFromSelector(#selector(getPlayerStatus(_:callback:))),
            "startRecording":     NSStringFromSelector(#selector(startRecording(_:callback:))),
            "pauseRecording":     NSStringFromSelector(#selector(pauseRecording(_:callback:))),
            "resumeRecording":    NSStringFromSelector(#selector(resumeRecording(_:callback:))),
            "stopRecording":      NSStringFromSelector(#selector(stopRecording(_:callback:))),
            "setMeterSubscribed": NSStringFromSelector(#selector(setMeterSubscribed(_:subscribed:callback:))),
            "requestPermission":  NSStringFromSelector(#selector(requestPermission(_:))),
            "getPermissionStatus": NSStringFromSelector(#selector(getPermissionStatus(_:))),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    // MARK: - Playback

    @objc func play(_ source: String?, options: [String: Any]?, callback: LynxCallbackBlock?) {
        guard let source = source, !source.isEmpty else {
            callback?(["error": "Missing source"])
            return
        }
        let volume = (options?["volume"] as? NSNumber)?.doubleValue ?? 1.0
        let loop = (options?["loop"] as? NSNumber)?.boolValue ?? false
        let rate = (options?["rate"] as? NSNumber)?.doubleValue ?? 1.0
        let result = AudioPlayerRegistry.shared.create(
            source: source, volume: volume, loop: loop, rate: rate
        )
        callback?(result)
    }

    @objc func preload(_ source: String?, callback: LynxCallbackBlock?) {
        guard let source = source, !source.isEmpty else {
            callback?(["error": "Missing source"])
            return
        }
        callback?(AudioPlayerRegistry.shared.preload(source: source))
    }

    @objc func pausePlayer(_ id: NSNumber, callback: LynxCallbackBlock?) {
        callback?(AudioPlayerRegistry.shared.pause(id: id.int64Value))
    }

    @objc func resumePlayer(_ id: NSNumber, callback: LynxCallbackBlock?) {
        callback?(AudioPlayerRegistry.shared.resume(id: id.int64Value))
    }

    @objc func stopPlayer(_ id: NSNumber, callback: LynxCallbackBlock?) {
        callback?(AudioPlayerRegistry.shared.stop(id: id.int64Value))
    }

    @objc func seekPlayer(_ id: NSNumber, seconds: NSNumber, callback: LynxCallbackBlock?) {
        callback?(AudioPlayerRegistry.shared.seek(id: id.int64Value, seconds: seconds.doubleValue))
    }

    @objc func setPlayerVolume(_ id: NSNumber, volume: NSNumber, callback: LynxCallbackBlock?) {
        callback?(AudioPlayerRegistry.shared.setVolume(id: id.int64Value, volume: volume.doubleValue))
    }

    @objc func getPlayerStatus(_ id: NSNumber, callback: LynxCallbackBlock?) {
        callback?(AudioPlayerRegistry.shared.status(id: id.int64Value))
    }

    // MARK: - Recording

    @objc func startRecording(_ options: [String: Any]?, callback: LynxCallbackBlock?) {
        let path = options?["outputPath"] as? String
        let format = (options?["format"] as? String) ?? "m4a"
        let sampleRate = (options?["sampleRate"] as? NSNumber)?.doubleValue ?? 44100
        let channels = (options?["channels"] as? NSNumber)?.intValue ?? 1

        // iOS demands the mic permission be granted before AVAudioRecorder
        // can `record()` — if not granted yet, surface that error rather
        // than silently producing a 0-byte file.
        let status = AVAudioSession.sharedInstance().recordPermission
        guard status == .granted else {
            callback?(["error": "Microphone permission not granted"])
            return
        }

        callback?(AudioRecorderRegistry.shared.start(
            outputPath: path, format: format, sampleRate: sampleRate, channels: channels
        ))
    }

    @objc func pauseRecording(_ id: NSNumber, callback: LynxCallbackBlock?) {
        callback?(AudioRecorderRegistry.shared.pause(id: id.int64Value))
    }

    @objc func resumeRecording(_ id: NSNumber, callback: LynxCallbackBlock?) {
        callback?(AudioRecorderRegistry.shared.resume(id: id.int64Value))
    }

    @objc func stopRecording(_ id: NSNumber, callback: LynxCallbackBlock?) {
        callback?(AudioRecorderRegistry.shared.stop(id: id.int64Value))
    }

    @objc func setMeterSubscribed(_ id: NSNumber, subscribed: NSNumber, callback: LynxCallbackBlock?) {
        callback?(AudioRecorderRegistry.shared.setMeterSubscribed(
            id: id.int64Value, subscribed: subscribed.boolValue
        ))
    }

    // MARK: - Permission

    @objc func requestPermission(_ callback: LynxCallbackBlock?) {
        let session = AVAudioSession.sharedInstance()
        switch session.recordPermission {
        case .granted:
            callback?(["status": "granted", "canAskAgain": false])
        case .denied:
            // iOS won't re-prompt on second call — user must visit Settings.
            callback?(["status": "denied", "canAskAgain": false])
        case .undetermined:
            session.requestRecordPermission { granted in
                callback?([
                    "status": granted ? "granted" : "denied",
                    "canAskAgain": false,
                ])
            }
        @unknown default:
            callback?(["status": "denied", "canAskAgain": false])
        }
    }

    @objc func getPermissionStatus(_ callback: LynxCallbackBlock?) {
        let session = AVAudioSession.sharedInstance()
        switch session.recordPermission {
        case .granted:
            callback?(["status": "granted", "canAskAgain": false])
        case .denied:
            callback?(["status": "denied", "canAskAgain": false])
        case .undetermined:
            callback?(["status": "undetermined", "canAskAgain": true])
        @unknown default:
            callback?(["status": "denied", "canAskAgain": false])
        }
    }
}
