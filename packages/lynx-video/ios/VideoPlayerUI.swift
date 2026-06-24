import Foundation
import UIKit
import AVFoundation
import Lynx

/// Native UI for the `<video-player>` JSX element.
///
/// Registered via the autolinker — `signalx-module.json`'s `ios.uiComponents`
/// produces `config.registerUI(VideoPlayerUI.self, withName: "video-player")`
/// in the generated `GeneratedComponentRegistry.swift`.
///
/// Prop / event surface (v1):
///   - `src`           → URL (URL-loaded) or `file://` (local file)
///   - `poster`        → image displayed before the first frame
///   - `autoplay`      → start as soon as the asset is ready
///   - `playing`       → declarative play/pause toggle
///   - `loop`          → restart at end-of-clip
///   - `muted`         → mute audio
///   - `volume`        → 0..1
///   - `controls`      → show platform-default controls overlay
///   - `resize-mode`   → contain | cover | stretch
///   - `start-time`    → one-shot initial seek (seconds) before first play
///   - `bindload`      → asset metadata ready
///   - `bindend`       → playback finished
///   - `binderror`     → load / playback failure
///   - `bindtimeupdate` → ~4×/sec position broadcast
///   - `bindvideostatechange` → playing | paused | buffering | ended transitions
///
/// Imperative methods (`seek`, `getStatus`) are tracked as a v2 follow-up
/// — they need the Lynx UIMethodInvoker surface that isn't wired through
/// sigx-lynx yet (same blocker as `WebView.goBack` / `Map.animateToRegion`).
// Class is NOT marked `@objc` — Swift forbids that on generic subclasses
// of an ObjC lightweight-generic type like `LynxUI<__covariant V>`. Member-
// level `@objc` / `@objc(name)` annotations still bridge because `LynxUI`
// itself is `@objc`.
//
// IMPORTANT: prop setters MUST be registered via `propSetterLookUp()` (see
// below), NOT by relying on the per-method `__lynx_prop_config__*` discovery
// alone. On a non-`@objc` subclass of a specialized generic ObjC base, the
// runtime's discovery path (`class_copyMethodList(metaclass)`) doesn't
// reliably enumerate the Swift `@objc(name)` class methods, so a prop's
// setter info comes back without a usable selector — `methodSignatureForSelector:`
// returns nil and Lynx crashes with `NSInvocation … method signature argument
// cannot be nil` on the first prop apply (see signalxjs/lynx#535). The
// explicit `propSetterLookUp()` table is the robust path every other sigx
// LynxUI component (WebView / Map / RichText) already uses.
public class VideoPlayerUI: LynxUI<UIView> {

    private var player: AVPlayer?
    private var playerLayer: AVPlayerLayer?
    private var posterView: UIImageView?
    private var controlsView: UIView?
    private var timeObserver: Any?
    private var statusObservation: NSKeyValueObservation?
    private var timeControlStatusObservation: NSKeyValueObservation?
    private var didReachEndObserver: NSObjectProtocol?

    // Pending prop values applied after createView() and after the asset
    // reaches `.readyToPlay` (volume, muted, autoplay/playing).
    private var pendingAutoplay = false
    private var pendingPlaying: Bool?
    private var pendingLoop = false
    private var pendingMuted = false
    private var pendingVolume: Float = 1.0
    private var pendingResizeMode: AVLayerVideoGravity = .resizeAspect
    private var pendingControls = false
    private var pendingPosterURL: URL?
    private var pendingStartTime: Double?
    private var didEmitLoad = false
    // Suppresses the `paused` statechange that AVPlayer's timeControlStatus
    // emits when a clip finishes — `bindend`/the `ended` statechange already
    // cover that transition. Re-armed once playback resumes.
    private var reachedEnd = false

    // MARK: - LynxUI overrides

    public override func createView() -> UIView? {
        let container = UIView(frame: .zero)
        container.backgroundColor = .black
        container.clipsToBounds = true
        return container
    }

    public override func layoutDidFinished() {
        super.layoutDidFinished()
        // `view` is a non-optional method on `LynxUI` in this SDK — call it.
        let container = view()
        playerLayer?.frame = container.bounds
        posterView?.frame = container.bounds
        controlsView?.frame = container.bounds
    }

    deinit {
        teardownPlayer()
    }

    // MARK: - Prop-setter registration

    // Explicit prop-setter registration. The runtime prefers this single
    // `[propName, fullSelector]` table over the per-method
    // `__lynx_prop_config__*` discovery — see SigxWebViewUI for the full
    // rationale. It's the path that actually works for a non-`@objc` generic
    // LynxUI subclass; the `__lynx_prop_config__*` methods below are kept for
    // parity with the macro convention but the table is what Lynx uses.
    @objc public class func propSetterLookUp() -> NSArray {
        return [
            ["src", "setSrc:requestReset:"],
            ["poster", "setPoster:requestReset:"],
            ["autoplay", "setAutoplay:requestReset:"],
            ["playing", "setPlaying:requestReset:"],
            ["loop", "setLoop:requestReset:"],
            ["muted", "setMuted:requestReset:"],
            ["volume", "setVolume:requestReset:"],
            ["controls", "setControls:requestReset:"],
            ["resize-mode", "setResizeMode:requestReset:"],
            ["start-time", "setStartTime:requestReset:"],
        ] as NSArray
    }

    // MARK: - Prop setters

    // Params are `Any?`, not `NSString?`: Lynx delivers JS `null` (and any unset
    // optional string prop) as `NSNull`. Casting via `value as String?` then
    // messages `NSNull` with `-length` and crashes (`-[NSNull length]`);
    // the type-checked `value as? String` returns nil for `NSNull` instead.
    @objc public func setSrc(_ value: Any?, requestReset: Bool) {
        let raw = (value as? String) ?? ""
        if raw.isEmpty {
            // Clearing the prop must actually stop and release the current
            // asset — otherwise a re-render that drops `src` would leave
            // the previous clip playing.
            teardownPlayer()
            didEmitLoad = false
            return
        }
        guard let url = resolveURL(raw) else {
            teardownPlayer()
            didEmitLoad = false
            fireEvent("error", params: ["message": "Invalid src: \(raw)"])
            return
        }
        loadAsset(url: url)
    }

    @objc(__lynx_prop_config__src)
    public class func __lynxPropConfigSrc() -> [String] {
        return ["src", "setSrc", "NSString *"]
    }

    @objc public func setPoster(_ value: Any?, requestReset: Bool) {
        guard let raw = value as? String, !raw.isEmpty, let url = resolveURL(raw) else {
            posterView?.removeFromSuperview()
            posterView = nil
            return
        }
        pendingPosterURL = url
        loadPoster(url: url)
    }

    @objc(__lynx_prop_config__poster)
    public class func __lynxPropConfigPoster() -> [String] {
        return ["poster", "setPoster", "NSString *"]
    }

    @objc public func setAutoplay(_ value: Bool, requestReset: Bool) {
        pendingAutoplay = value
        if value, let player = player, player.currentItem?.status == .readyToPlay {
            player.play()
        }
    }

    @objc(__lynx_prop_config__autoplay)
    public class func __lynxPropConfigAutoplay() -> [String] {
        return ["autoplay", "setAutoplay", "BOOL"]
    }

    @objc public func setPlaying(_ value: Bool, requestReset: Bool) {
        pendingPlaying = value
        guard let player = player else { return }
        if player.currentItem?.status == .readyToPlay {
            if value { player.play() } else { player.pause() }
        }
    }

    @objc(__lynx_prop_config__playing)
    public class func __lynxPropConfigPlaying() -> [String] {
        return ["playing", "setPlaying", "BOOL"]
    }

    @objc public func setLoop(_ value: Bool, requestReset: Bool) {
        pendingLoop = value
    }

    @objc(__lynx_prop_config__loop)
    public class func __lynxPropConfigLoop() -> [String] {
        return ["loop", "setLoop", "BOOL"]
    }

    @objc public func setMuted(_ value: Bool, requestReset: Bool) {
        pendingMuted = value
        player?.isMuted = value
    }

    @objc(__lynx_prop_config__muted)
    public class func __lynxPropConfigMuted() -> [String] {
        return ["muted", "setMuted", "BOOL"]
    }

    // Param is `Any?`, not `NSNumber?`: an unset/cleared number prop arrives as
    // `NSNull`, not `nil`. A typed `NSNumber?` parameter bridges `NSNull` into
    // the slot, and `value?.doubleValue` then messages `-doubleValue` on
    // `NSNull` and crashes (`-[NSNull doubleValue]`). The type-checked
    // `value as? NSNumber` returns nil for `NSNull` instead. (Same trap as the
    // string setters above and `setStartTime` below.)
    @objc public func setVolume(_ value: Any?, requestReset: Bool) {
        let v = Float(max(0, min(1, ((value as? NSNumber)?.doubleValue ?? 1.0))))
        pendingVolume = v
        player?.volume = v
    }

    @objc(__lynx_prop_config__volume)
    public class func __lynxPropConfigVolume() -> [String] {
        return ["volume", "setVolume", "NSNumber *"]
    }

    @objc public func setControls(_ value: Bool, requestReset: Bool) {
        pendingControls = value
        // Native-controls UI is intentionally minimal in v1 — the iOS
        // AVPlayerViewController would conflict with Lynx's view tree
        // (it owns its own VC). We render a simple tap-to-play overlay
        // instead. Apps that want full transport controls today can
        // build their own overlay using the `playing` prop.
        if value {
            attachTapToggleOverlay()
        } else {
            controlsView?.removeFromSuperview()
            controlsView = nil
        }
    }

    @objc(__lynx_prop_config__controls)
    public class func __lynxPropConfigControls() -> [String] {
        return ["controls", "setControls", "BOOL"]
    }

    @objc public func setResizeMode(_ value: Any?, requestReset: Bool) {
        let mode = (value as? String) ?? "contain"
        let gravity: AVLayerVideoGravity
        switch mode {
        case "cover":   gravity = .resizeAspectFill
        case "stretch": gravity = .resize
        default:        gravity = .resizeAspect
        }
        pendingResizeMode = gravity
        playerLayer?.videoGravity = gravity
    }

    @objc(__lynx_prop_config__resize_mode)
    public class func __lynxPropConfigResizeMode() -> [String] {
        return ["resize-mode", "setResizeMode", "NSString *"]
    }

    // Param is `Any?`, not `NSNumber?`: like the string props above, a cleared
    // or undefined number prop can arrive as `NSNull`. A typed `NSNumber?`
    // parameter would reinterpret that pointer and crash when `doubleValue` is
    // messaged on it; `value as? NSNumber` returns nil for `NSNull` instead.
    @objc public func setStartTime(_ value: Any?, requestReset: Bool) {
        let v = (value as? NSNumber)?.doubleValue ?? 0
        pendingStartTime = v > 0 ? v : nil
        // `handleReadyToPlay` consumes the pending seek, but it only runs once,
        // on the first `.readyToPlay`. If the prop is set/updated after the
        // item is already ready (but still at the start, before the first
        // play), that handler won't run again and the initial offset would be
        // silently dropped — so apply the one-shot seek now and clear it.
        if let startSec = pendingStartTime,
           let player = player,
           player.currentItem?.status == .readyToPlay,
           CMTimeGetSeconds(player.currentTime()) < 0.001 {
            player.seek(to: CMTime(seconds: startSec, preferredTimescale: 600))
            pendingStartTime = nil
        }
    }

    @objc(__lynx_prop_config__start_time)
    public class func __lynxPropConfigStartTime() -> [String] {
        return ["start-time", "setStartTime", "NSNumber *"]
    }

    // MARK: - Asset lifecycle

    private func loadAsset(url: URL) {
        teardownPlayer()

        let item = AVPlayerItem(url: url)
        let player = AVPlayer(playerItem: item)
        player.isMuted = pendingMuted
        player.volume = pendingVolume

        let layer = AVPlayerLayer(player: player)
        layer.videoGravity = pendingResizeMode
        let hostView = view()
        layer.frame = hostView.bounds
        hostView.layer.insertSublayer(layer, at: 0)

        self.player = player
        self.playerLayer = layer
        self.didEmitLoad = false
        self.reachedEnd = false

        // KVO on timeControlStatus — emit a `statechange` whenever playback
        // transitions between playing / paused / buffering. This surfaces
        // pauses driven by the system controls overlay or OS interruptions
        // that the declarative `playing` prop can't observe.
        timeControlStatusObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in
            guard let self = self else { return }
            let positionMs = msFromSeconds(CMTimeGetSeconds(player.currentTime()))
            switch player.timeControlStatus {
            case .playing:
                self.reachedEnd = false
                self.fireEvent("videostatechange", params: ["state": "playing", "positionMs": positionMs])
            case .waitingToPlayAtSpecifiedRate:
                self.fireEvent("videostatechange", params: ["state": "buffering", "positionMs": positionMs])
            case .paused:
                // The end-of-clip pause is reported as `ended` instead.
                if !self.reachedEnd {
                    self.fireEvent("videostatechange", params: ["state": "paused", "positionMs": positionMs])
                }
            @unknown default:
                break
            }
        }

        // KVO on item.status — first time we hit `.readyToPlay`, fire
        // `bindload` with the asset's duration + natural size and apply
        // the queued autoplay/playing prop.
        statusObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            guard let self = self else { return }
            switch item.status {
            case .readyToPlay:
                self.handleReadyToPlay(item: item)
            case .failed:
                let message = item.error?.localizedDescription ?? "Asset failed to load"
                self.fireEvent("error", params: ["message": message])
            default:
                break
            }
        }

        didReachEndObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main,
        ) { [weak self] _ in
            self?.handleDidReachEnd()
        }

        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.25, preferredTimescale: CMTimeScale(NSEC_PER_SEC)),
            queue: .main,
        ) { [weak self] time in
            // Same NaN/Inf trap as duration on live streams — guard the
            // position-observer cast too. `CMTimeGetSeconds` returns NaN
            // for indefinite / unknown times, and `Int(.nan)` traps.
            let positionMs = msFromSeconds(CMTimeGetSeconds(time))
            self?.fireEvent("timeupdate", params: ["positionMs": positionMs])
        }
    }

    private func handleReadyToPlay(item: AVPlayerItem) {
        guard !didEmitLoad else { return }
        didEmitLoad = true

        // Live streams and assets with indeterminate duration return
        // `CMTime.indefinite` whose `CMTimeGetSeconds` is `NaN` (and some
        // edge cases produce `+Inf`). `Int(Double.nan)` traps, so funnel
        // through a finite-check helper before reporting.
        let durationMs = msFromSeconds(CMTimeGetSeconds(item.duration))
        var width = 0
        var height = 0
        if let track = item.asset.tracks(withMediaType: .video).first {
            let size = track.naturalSize.applying(track.preferredTransform)
            width = Int(abs(size.width))
            height = Int(abs(size.height))
        }
        fireEvent("load", params: [
            "durationMs": durationMs,
            "width": width,
            "height": height,
        ])

        // One-shot initial seek before the first play.
        if let startSec = pendingStartTime, startSec > 0 {
            player?.seek(to: CMTime(seconds: startSec, preferredTimescale: 600))
            pendingStartTime = nil
        }

        // Apply queued props. `playing` overrides `autoplay` if both set.
        if let playing = pendingPlaying {
            if playing { player?.play() } else { player?.pause() }
        } else if pendingAutoplay {
            player?.play()
        }
        // First frame painted — hide the poster.
        posterView?.removeFromSuperview()
        posterView = nil
    }

    private func handleDidReachEnd() {
        // The clip hit its boundary — latch `reachedEnd` before anything else
        // so the KVO handler suppresses the trailing `paused` that AVPlayer's
        // timeControlStatus emits there. This applies to both paths: when
        // looping, the `.playing` KVO case re-arms `reachedEnd = false` as the
        // restart begins; when not looping, it stays latched through teardown.
        reachedEnd = true
        if pendingLoop {
            player?.seek(to: .zero)
            player?.play()
            return
        }
        let positionMs = msFromSeconds(CMTimeGetSeconds(player?.currentItem?.duration ?? .zero))
        fireEvent("videostatechange", params: ["state": "ended", "positionMs": positionMs])
        fireEvent("end", params: [:])
    }

    private func teardownPlayer() {
        if let observer = timeObserver { player?.removeTimeObserver(observer) }
        timeObserver = nil
        statusObservation?.invalidate()
        statusObservation = nil
        timeControlStatusObservation?.invalidate()
        timeControlStatusObservation = nil
        if let observer = didReachEndObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        didReachEndObserver = nil

        player?.pause()
        playerLayer?.removeFromSuperlayer()
        player = nil
        playerLayer = nil
    }

    private func loadPoster(url: URL) {
        // Best-effort, async, no caching layer. Apps that need a CDN-aware
        // image pipeline can roll their own and pass a `file://` poster.
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let self = self, let data = data, let image = UIImage(data: data) else { return }
            DispatchQueue.main.async {
                // Race guard — if `poster` was reset or replaced while this
                // request was in flight, drop the stale image. Without
                // this, a fast Settings flip from PosterA → PosterB could
                // land PosterA on screen if its download completed second.
                guard self.pendingPosterURL == url,
                      self.posterView == nil,
                      !self.didEmitLoad else { return }
                let container = self.view()
                let iv = UIImageView(image: image)
                iv.frame = container.bounds
                iv.contentMode = .scaleAspectFit
                container.addSubview(iv)
                self.posterView = iv
            }
        }.resume()
    }

    private func attachTapToggleOverlay() {
        guard controlsView == nil else { return }
        let container = view()
        let overlay = UIView(frame: container.bounds)
        overlay.backgroundColor = UIColor.clear
        let tap = UITapGestureRecognizer(target: self, action: #selector(togglePlayPause))
        overlay.addGestureRecognizer(tap)
        container.addSubview(overlay)
        controlsView = overlay
    }

    @objc private func togglePlayPause() {
        guard let player = player else { return }
        if player.timeControlStatus == .playing {
            player.pause()
        } else {
            player.play()
        }
    }

    // MARK: - Helpers

    private func resolveURL(_ source: String) -> URL? {
        if source.hasPrefix("file://") || source.hasPrefix("http://") || source.hasPrefix("https://") {
            return URL(string: source)
        }
        if source.hasPrefix("/") {
            return URL(fileURLWithPath: source)
        }
        return URL(string: source)
    }

    fileprivate func fireEvent(_ name: String, params: [String: Any]) {
        let event = LynxCustomEvent(name: name, targetSign: sign, params: params)
        // Swift renames the ObjC `sendCustomEvent:` selector to `send(_:)`.
        context?.eventEmitter?.send(event)
    }
}

/// Convert seconds (possibly `NaN` or `±Inf`) to clamped milliseconds.
/// `Int(Double.nan)` and `Int(.infinity)` trap, so live streams and
/// indeterminate durations would crash the app without this guard.
fileprivate func msFromSeconds(_ seconds: Double) -> Int {
    guard seconds.isFinite, seconds > 0 else { return 0 }
    return Int(seconds * 1000.0)
}
