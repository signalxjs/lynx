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
///   - `bindload`      → asset metadata ready
///   - `bindend`       → playback finished
///   - `binderror`     → load / playback failure
///   - `bindtimeupdate` → ~4×/sec position broadcast
///
/// Imperative methods (`seek`, `getStatus`) are tracked as a v2 follow-up
/// — they need the Lynx UIMethodInvoker surface that isn't wired through
/// sigx-lynx yet (same blocker as `WebView.goBack` / `Map.animateToRegion`).
@objc public class VideoPlayerUI: LynxUI<UIView> {

    private var player: AVPlayer?
    private var playerLayer: AVPlayerLayer?
    private var posterView: UIImageView?
    private var controlsView: UIView?
    private var timeObserver: Any?
    private var statusObservation: NSKeyValueObservation?
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
    private var didEmitLoad = false

    // MARK: - LynxUI overrides

    public override func createView() -> UIView? {
        let container = UIView(frame: .zero)
        container.backgroundColor = .black
        container.clipsToBounds = true
        return container
    }

    public override func layoutDidFinished() {
        super.layoutDidFinished()
        guard let container = view else { return }
        playerLayer?.frame = container.bounds
        posterView?.frame = container.bounds
        controlsView?.frame = container.bounds
    }

    deinit {
        teardownPlayer()
    }

    // MARK: - Prop setters

    @objc public func setSrc(_ value: NSString?, requestReset: Bool) {
        guard let raw = value as String?, !raw.isEmpty, let url = resolveURL(raw) else {
            return
        }
        loadAsset(url: url)
    }

    @objc(__lynx_prop_config__src)
    public class func __lynxPropConfigSrc() -> [String] {
        return ["src", "setSrc:requestReset:", "NSString *"]
    }

    @objc public func setPoster(_ value: NSString?, requestReset: Bool) {
        guard let raw = value as String?, !raw.isEmpty, let url = resolveURL(raw) else {
            posterView?.removeFromSuperview()
            posterView = nil
            return
        }
        pendingPosterURL = url
        loadPoster(url: url)
    }

    @objc(__lynx_prop_config__poster)
    public class func __lynxPropConfigPoster() -> [String] {
        return ["poster", "setPoster:requestReset:", "NSString *"]
    }

    @objc public func setAutoplay(_ value: Bool, requestReset: Bool) {
        pendingAutoplay = value
        if value, let player = player, player.currentItem?.status == .readyToPlay {
            player.play()
        }
    }

    @objc(__lynx_prop_config__autoplay)
    public class func __lynxPropConfigAutoplay() -> [String] {
        return ["autoplay", "setAutoplay:requestReset:", "BOOL"]
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
        return ["playing", "setPlaying:requestReset:", "BOOL"]
    }

    @objc public func setLoop(_ value: Bool, requestReset: Bool) {
        pendingLoop = value
    }

    @objc(__lynx_prop_config__loop)
    public class func __lynxPropConfigLoop() -> [String] {
        return ["loop", "setLoop:requestReset:", "BOOL"]
    }

    @objc public func setMuted(_ value: Bool, requestReset: Bool) {
        pendingMuted = value
        player?.isMuted = value
    }

    @objc(__lynx_prop_config__muted)
    public class func __lynxPropConfigMuted() -> [String] {
        return ["muted", "setMuted:requestReset:", "BOOL"]
    }

    @objc public func setVolume(_ value: NSNumber?, requestReset: Bool) {
        let v = Float(max(0, min(1, (value?.doubleValue ?? 1.0))))
        pendingVolume = v
        player?.volume = v
    }

    @objc(__lynx_prop_config__volume)
    public class func __lynxPropConfigVolume() -> [String] {
        return ["volume", "setVolume:requestReset:", "NSNumber *"]
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
        return ["controls", "setControls:requestReset:", "BOOL"]
    }

    @objc public func setResizeMode(_ value: NSString?, requestReset: Bool) {
        let mode = (value as String?) ?? "contain"
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
        return ["resize-mode", "setResizeMode:requestReset:", "NSString *"]
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
        if let view = view {
            layer.frame = view.bounds
            view.layer.insertSublayer(layer, at: 0)
        }

        self.player = player
        self.playerLayer = layer
        self.didEmitLoad = false

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
            let positionMs = Int(CMTimeGetSeconds(time) * 1000.0)
            self?.fireEvent("timeupdate", params: ["positionMs": positionMs])
        }
    }

    private func handleReadyToPlay(item: AVPlayerItem) {
        guard !didEmitLoad else { return }
        didEmitLoad = true

        let durationMs = max(0, Int(CMTimeGetSeconds(item.duration) * 1000.0))
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
        if pendingLoop {
            player?.seek(to: .zero)
            player?.play()
            return
        }
        fireEvent("end", params: [:])
    }

    private func teardownPlayer() {
        if let observer = timeObserver { player?.removeTimeObserver(observer) }
        timeObserver = nil
        statusObservation?.invalidate()
        statusObservation = nil
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
                guard self.posterView == nil, !self.didEmitLoad, let container = self.view else { return }
                let iv = UIImageView(image: image)
                iv.frame = container.bounds
                iv.contentMode = .scaleAspectFit
                container.addSubview(iv)
                self.posterView = iv
            }
        }.resume()
    }

    private func attachTapToggleOverlay() {
        guard controlsView == nil, let container = view else { return }
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
        context?.eventEmitter?.sendCustomEvent(event)
    }
}
