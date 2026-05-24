import Foundation
import AVFoundation

/// Owns the set of `AVAudioPlayer` instances created by JS-side
/// `Audio.play()` calls. Each entry is keyed by an `Int64` id assigned at
/// allocation; JS holds the id and re-passes it for every method call on
/// the handle.
///
/// Multiple players may be active concurrently (the design choice from the
/// plan — background music + UI sound effects). Lifecycle: `play` allocates
/// + retains the session; `stopPlayer` (or natural end-of-clip) releases.
final class AudioPlayerRegistry: NSObject, AVAudioPlayerDelegate {

    static let shared = AudioPlayerRegistry()

    private let queue = DispatchQueue(label: "com.sigx.audio.players")
    private var players: [Int64: AVAudioPlayer] = [:]
    private var nextId: Int64 = 1

    /// Create + start a new player.
    /// Returns `(id, durationMs)` on success or `error` on failure.
    func create(source: String, volume: Double, loop: Bool, rate: Double) -> [String: Any] {
        guard let url = resolveURL(source) else {
            return ["error": "Invalid source: \(source)"]
        }

        let player: AVAudioPlayer
        do {
            player = try AVAudioPlayer(contentsOf: url)
        } catch {
            return ["error": "Failed to load audio: \(error.localizedDescription)"]
        }

        player.delegate = self
        player.volume = Float(max(0, min(1, volume)))
        player.numberOfLoops = loop ? -1 : 0
        if rate != 1.0 {
            player.enableRate = true
            player.rate = Float(rate)
        }
        player.prepareToPlay()

        let id: Int64 = queue.sync {
            let allocated = nextId
            nextId += 1
            players[allocated] = player
            return allocated
        }

        AudioSessionCoordinator.shared.retainPlayer()
        guard player.play() else {
            removePlayer(id: id)
            AudioSessionCoordinator.shared.releasePlayer()
            return ["error": "Failed to start playback"]
        }

        return [
            "id": id,
            "durationMs": Int(player.duration * 1000.0),
        ]
    }

    func pause(id: Int64) -> [String: Any] {
        guard let player = player(forId: id) else { return ["error": "Player \(id) not found"] }
        player.pause()
        return [:]
    }

    func resume(id: Int64) -> [String: Any] {
        guard let player = player(forId: id) else { return ["error": "Player \(id) not found"] }
        player.play()
        return [:]
    }

    func stop(id: Int64) -> [String: Any] {
        guard let player = player(forId: id) else { return ["error": "Player \(id) not found"] }
        player.stop()
        removePlayer(id: id)
        AudioSessionCoordinator.shared.releasePlayer()
        return [:]
    }

    func seek(id: Int64, seconds: Double) -> [String: Any] {
        guard let player = player(forId: id) else { return ["error": "Player \(id) not found"] }
        player.currentTime = max(0, min(player.duration, seconds))
        return [:]
    }

    func setVolume(id: Int64, volume: Double) -> [String: Any] {
        guard let player = player(forId: id) else { return ["error": "Player \(id) not found"] }
        player.volume = Float(max(0, min(1, volume)))
        return [:]
    }

    func status(id: Int64) -> [String: Any] {
        guard let player = player(forId: id) else {
            return ["positionMs": 0, "durationMs": 0, "playing": false]
        }
        return [
            "positionMs": Int(player.currentTime * 1000.0),
            "durationMs": Int(player.duration * 1000.0),
            "playing": player.isPlaying,
        ]
    }

    /// Synchronous decode → duration (used by `Audio.preload`). The player
    /// is discarded immediately; nothing is added to the registry.
    func preload(source: String) -> [String: Any] {
        guard let url = resolveURL(source) else {
            return ["error": "Invalid source: \(source)"]
        }
        do {
            let player = try AVAudioPlayer(contentsOf: url)
            return ["durationMs": Int(player.duration * 1000.0)]
        } catch {
            return ["error": "Failed to load audio: \(error.localizedDescription)"]
        }
    }

    // MARK: - AVAudioPlayerDelegate

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully _: Bool) {
        let id: Int64? = queue.sync {
            players.first(where: { $0.value === player })?.key
        }
        guard let id = id else { return }
        // Looping players don't trigger this callback; if we get here the
        // clip really has ended. Release the session ref-count and clean
        // up — JS handle is now effectively dead.
        removePlayer(id: id)
        AudioSessionCoordinator.shared.releasePlayer()
        AudioEventBus.shared.publishPlayerEnd(id: id)
    }

    // MARK: - Helpers

    private func player(forId id: Int64) -> AVAudioPlayer? {
        queue.sync { players[id] }
    }

    private func removePlayer(id: Int64) {
        queue.sync { players.removeValue(forKey: id) }
    }

    private func resolveURL(_ source: String) -> URL? {
        // file:// → URL(string:); raw paths → fileURLWithPath; http(s) → URL.
        if source.hasPrefix("file://") || source.hasPrefix("http://") || source.hasPrefix("https://") {
            return URL(string: source)
        }
        if source.hasPrefix("/") {
            return URL(fileURLWithPath: source)
        }
        return URL(string: source)
    }
}
