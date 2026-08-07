import Foundation
import AVFoundation

/// Reference-counted `AVAudioSession` category coordinator.
///
/// Tracks the number of active players and recorders and flips the session
/// category accordingly:
///
/// * recording active → `.playAndRecord`
/// * only playing      → `.playback` (with `.mixWithOthers`)
/// * nothing active    → deactivated, restored to `.ambient`
///
/// Callers `retainPlayer()` / `retainRecorder()` on start and `release...`
/// on stop. All access is serialised on a dedicated queue so the category
/// flip is atomic w.r.t. the counter mutation.
final class AudioSessionCoordinator {

    static let shared = AudioSessionCoordinator()

    private let queue = DispatchQueue(label: "com.sigx.audio.session")
    private var playerCount = 0
    private var recorderCount = 0

    private init() {
        // Observed for the process lifetime rather than per player/recorder:
        // an interruption is a fact about the session, and a recorder that is
        // torn down *by* the interruption would otherwise miss its own
        // notification.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleInterruption(_:)),
            name: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance()
        )
    }

    /// Maps `AVAudioSession.interruptionNotification` onto the JS event.
    ///
    /// `shouldResume` is only meaningful on `.ended`, and iOS sets it when the
    /// system considers it appropriate to start again — it is advice, not
    /// permission, so JS still decides.
    @objc private func handleInterruption(_ note: Notification) {
        guard
            let info = note.userInfo,
            let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: raw)
        else { return }

        switch type {
        case .began:
            AudioEventBus.shared.publishInterruption(type: "began", shouldResume: false)
        case .ended:
            let options = (info[AVAudioSessionInterruptionOptionKey] as? UInt).map {
                AVAudioSession.InterruptionOptions(rawValue: $0)
            } ?? []
            AudioEventBus.shared.publishInterruption(
                type: "ended",
                shouldResume: options.contains(.shouldResume)
            )
        @unknown default:
            break
        }
    }

    func retainPlayer() {
        queue.sync {
            playerCount += 1
            applyCategoryLocked()
        }
    }

    func releasePlayer() {
        queue.sync {
            playerCount = max(0, playerCount - 1)
            applyCategoryLocked()
        }
    }

    func retainRecorder() {
        queue.sync {
            recorderCount += 1
            applyCategoryLocked()
        }
    }

    func releaseRecorder() {
        queue.sync {
            recorderCount = max(0, recorderCount - 1)
            applyCategoryLocked()
        }
    }

    private func applyCategoryLocked() {
        let session = AVAudioSession.sharedInstance()
        do {
            if recorderCount > 0 {
                try session.setCategory(.playAndRecord,
                                        mode: .default,
                                        options: [.defaultToSpeaker, .allowBluetooth])
                try session.setActive(true)
            } else if playerCount > 0 {
                try session.setCategory(.playback,
                                        mode: .default,
                                        options: [.mixWithOthers])
                try session.setActive(true)
            } else {
                // Nothing active — back to ambient so silent-mode etc. behave
                // normally. setActive(false) with .notifyOthersOnDeactivation
                // restores other apps' audio if we interrupted them.
                try session.setCategory(.ambient, mode: .default)
                try session.setActive(false, options: [.notifyOthersOnDeactivation])
            }
        } catch {
            NSLog("[lynx-audio] AudioSession category flip failed: \(error)")
        }
    }
}
