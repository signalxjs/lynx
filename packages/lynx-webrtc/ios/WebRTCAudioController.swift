import AVFoundation
import Foundation
import WebRTC

/// Call-audio session management, ref-counted across live peer
/// connections.
///
/// WebRTC's `RTCAudioSession` is put in manual-audio mode once (at factory
/// init) so libwebrtc never reconfigures AVAudioSession behind our back.
/// The first live peer configures `.playAndRecord` / `.voiceChat` with
/// `.defaultToSpeaker` and enables WebRTC audio; the last peer to close
/// disables it and deactivates the session. The configuration is
/// re-asserted on route changes and interruption end so another module
/// (e.g. `@sigx/lynx-audio`) flipping the shared AVAudioSession during a
/// call recovers automatically.
final class WebRTCAudioController {

    static let shared = WebRTCAudioController()

    private let queue = DispatchQueue(label: "com.sigx.webrtc.audio")
    private var livePeers = 0
    private var route: String = "speaker"
    private var observersInstalled = false

    /// Called once when the peer connection factory is created.
    func enableManualAudioMode() {
        RTCAudioSession.sharedInstance().useManualAudio = true
    }

    func retain() {
        queue.sync {
            livePeers += 1
            guard livePeers == 1 else { return }
            installObserversLocked()
            activateLocked()
        }
    }

    func release() {
        queue.sync {
            guard livePeers > 0 else { return }
            livePeers -= 1
            guard livePeers == 0 else { return }
            route = "speaker"
            deactivateLocked()
        }
    }

    /// Route call audio to `"speaker"` or `"earpiece"`. Returns an error
    /// message or nil. Devices without an earpiece keep the speaker route.
    func setRoute(_ newRoute: String) -> String? {
        guard newRoute == "speaker" || newRoute == "earpiece" else {
            return "Unknown audio route \"\(newRoute)\""
        }
        return queue.sync {
            route = newRoute
            guard livePeers > 0 else { return nil } // applied when the next call starts
            return applyRouteLocked()
        }
    }

    // MARK: - Internals (all on `queue`)

    private func activateLocked() {
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .voiceChat,
                options: [.defaultToSpeaker, .allowBluetooth]
            )
            try session.setActive(true)
        } catch {
            NSLog("[lynx-webrtc] audio session activate failed: \(error)")
        }
        session.unlockForConfiguration()
        session.isAudioEnabled = true
        _ = applyRouteLocked()
    }

    private func deactivateLocked() {
        let session = RTCAudioSession.sharedInstance()
        session.isAudioEnabled = false
        session.lockForConfiguration()
        do {
            try session.setActive(false)
        } catch {
            // Deactivation races with other audio users — log and move on.
            NSLog("[lynx-webrtc] audio session deactivate failed: \(error)")
        }
        session.unlockForConfiguration()
    }

    private func applyRouteLocked() -> String? {
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        defer { session.unlockForConfiguration() }
        do {
            try session.overrideOutputAudioPort(route == "speaker" ? .speaker : .none)
            return nil
        } catch {
            return "setAudioOutput failed: \(error.localizedDescription)"
        }
    }

    private func installObserversLocked() {
        guard !observersInstalled else { return }
        observersInstalled = true
        let center = NotificationCenter.default
        center.addObserver(
            self,
            selector: #selector(handleRouteChange(_:)),
            name: AVAudioSession.routeChangeNotification,
            object: nil
        )
        center.addObserver(
            self,
            selector: #selector(handleInterruption(_:)),
            name: AVAudioSession.interruptionNotification,
            object: nil
        )
    }

    @objc private func handleRouteChange(_ notification: Notification) {
        queue.async { [weak self] in
            guard let self = self, self.livePeers > 0 else { return }
            _ = self.applyRouteLocked()
        }
    }

    @objc private func handleInterruption(_ notification: Notification) {
        guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
        queue.async { [weak self] in
            guard let self = self, self.livePeers > 0 else { return }
            // Re-assert the whole call configuration — the interrupting app
            // (or another module) may have changed category/active state.
            self.activateLocked()
        }
    }
}
