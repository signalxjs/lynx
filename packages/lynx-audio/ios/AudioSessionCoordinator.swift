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
