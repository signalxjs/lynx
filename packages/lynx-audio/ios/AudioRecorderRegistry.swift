import Foundation
import AVFoundation

/// Owns the active `AVAudioRecorder` instances. The plan permits one
/// recorder per process (the typical voice-note pattern); we still key
/// by id so the JS-side handle abstraction is consistent with players.
///
/// Metering is opt-in. `setMeterSubscribed(id, true)` from JS starts a
/// 100 ms timer that reads `peakPower`/`averagePower` and publishes to
/// `AudioEventBus`. The timer stops when the last meter subscriber
/// unsubscribes (`false`) or when the recorder is stopped/released.
final class AudioRecorderRegistry: NSObject, AVAudioRecorderDelegate {

    static let shared = AudioRecorderRegistry()

    private struct Entry {
        let recorder: AVAudioRecorder
        let outputURL: URL
        let startedAt: Date
        var pausedDuration: TimeInterval
        var pausedAt: Date?
        var meterTimer: DispatchSourceTimer?
    }

    private let queue = DispatchQueue(label: "com.sigx.audio.recorders")
    private var entries: [Int64: Entry] = [:]
    private var nextId: Int64 = 1

    func start(outputPath: String?, format: String, sampleRate: Double, channels: Int) -> [String: Any] {
        if !entries.isEmpty {
            return ["error": "A recording is already in progress"]
        }

        let url: URL
        if let outputPath = outputPath {
            url = URL(fileURLWithPath: outputPath)
        } else {
            let ext = (format.lowercased() == "wav") ? "wav" : "m4a"
            let name = "rec_\(UUID().uuidString).\(ext)"
            url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(name)
        }

        let settings: [String: Any]
        switch format.lowercased() {
        case "wav":
            settings = [
                AVFormatIDKey: Int(kAudioFormatLinearPCM),
                AVSampleRateKey: sampleRate,
                AVNumberOfChannelsKey: channels,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false,
            ]
        default:
            settings = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: sampleRate,
                AVNumberOfChannelsKey: channels,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
            ]
        }

        let recorder: AVAudioRecorder
        do {
            recorder = try AVAudioRecorder(url: url, settings: settings)
        } catch {
            return ["error": "Failed to create recorder: \(error.localizedDescription)"]
        }
        recorder.delegate = self
        recorder.isMeteringEnabled = true

        AudioSessionCoordinator.shared.retainRecorder()
        guard recorder.prepareToRecord(), recorder.record() else {
            AudioSessionCoordinator.shared.releaseRecorder()
            return ["error": "Failed to start recording"]
        }

        let id: Int64 = queue.sync {
            let allocated = nextId
            nextId += 1
            entries[allocated] = Entry(
                recorder: recorder,
                outputURL: url,
                startedAt: Date(),
                pausedDuration: 0,
                pausedAt: nil,
                meterTimer: nil,
            )
            return allocated
        }
        return ["id": id]
    }

    func pause(id: Int64) -> [String: Any] {
        return queue.sync {
            guard var entry = entries[id] else { return ["error": "Recorder \(id) not found"] }
            entry.recorder.pause()
            entry.pausedAt = Date()
            entries[id] = entry
            return [:]
        }
    }

    func resume(id: Int64) -> [String: Any] {
        return queue.sync {
            guard var entry = entries[id] else { return ["error": "Recorder \(id) not found"] }
            if let pausedAt = entry.pausedAt {
                entry.pausedDuration += Date().timeIntervalSince(pausedAt)
                entry.pausedAt = nil
            }
            entry.recorder.record()
            entries[id] = entry
            return [:]
        }
    }

    func stop(id: Int64) -> [String: Any] {
        let snapshot: Entry? = queue.sync { entries[id] }
        guard let entry = snapshot else { return ["error": "Recorder \(id) not found"] }

        entry.meterTimer?.cancel()
        entry.recorder.stop()

        let end = Date()
        var elapsed = end.timeIntervalSince(entry.startedAt) - entry.pausedDuration
        if let pausedAt = entry.pausedAt {
            // Stopped while paused — don't count the open paused window.
            elapsed -= end.timeIntervalSince(pausedAt)
        }
        let durationMs = max(0, Int(elapsed * 1000.0))

        var sizeBytes: Int = 0
        if let attrs = try? FileManager.default.attributesOfItem(atPath: entry.outputURL.path),
           let fileSize = attrs[.size] as? NSNumber {
            sizeBytes = fileSize.intValue
        }

        queue.sync { entries.removeValue(forKey: id) }
        AudioSessionCoordinator.shared.releaseRecorder()

        return [
            "uri": entry.outputURL.absoluteString,
            "durationMs": durationMs,
            "sizeBytes": sizeBytes,
        ]
    }

    func setMeterSubscribed(id: Int64, subscribed: Bool) -> [String: Any] {
        return queue.sync {
            guard var entry = entries[id] else { return ["error": "Recorder \(id) not found"] }

            if subscribed {
                guard entry.meterTimer == nil else { return [:] }
                let timer = DispatchSource.makeTimerSource(queue: queue)
                timer.schedule(deadline: .now() + .milliseconds(100),
                               repeating: .milliseconds(100))
                timer.setEventHandler { [weak self] in
                    self?.emitMeter(id: id)
                }
                timer.resume()
                entry.meterTimer = timer
            } else {
                entry.meterTimer?.cancel()
                entry.meterTimer = nil
            }
            entries[id] = entry
            return [:]
        }
    }

    // MARK: - AVAudioRecorderDelegate

    func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully _: Bool) {
        // Stop is normally triggered from JS via `stop(id:)`. This callback
        // only fires for hard interruptions (route change, route lost). We
        // leave cleanup to whichever path runs first — `entries.removeValue`
        // is idempotent and the session ref-count is released by stop().
    }

    private func emitMeter(id: Int64) {
        // Called from the meter `DispatchSourceTimer` which was created with
        // `queue: queue`. We're already on the serial queue here — a nested
        // `queue.sync { ... }` would deadlock — so read the recorder directly.
        guard let recorder = entries[id]?.recorder else { return }
        recorder.updateMeters()
        let peak = linear(fromDecibels: recorder.peakPower(forChannel: 0))
        let avg = linear(fromDecibels: recorder.averagePower(forChannel: 0))
        AudioEventBus.shared.publishMeter(id: id, peak: peak, avg: avg)
    }

    /// AVAudioRecorder reports power in dB (-160…0). The JS contract is
    /// linear 0..1 — convert via 10^(dB/20), clamped.
    private func linear(fromDecibels dB: Float) -> Double {
        if dB <= -160 { return 0 }
        if dB >= 0 { return 1 }
        return max(0, min(1, Double(pow(10.0, dB / 20.0))))
    }
}
