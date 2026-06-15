import AVFoundation
import Foundation
import Lynx
import WebRTC

/// Native WebRTC bridge — JS-callable side.
///
/// JS usage (via the `@sigx/lynx-webrtc` shim, not directly):
///
///   NativeModules.WebRTC.createPeer(id, config, cb)
///   NativeModules.WebRTC.createOffer(id, options, cb)
///   NativeModules.WebRTC.getUserMedia(trackId, constraints, cb)
///   ...
///
/// State lives in `PeerConnectionStore`. Async events (state changes, ICE
/// candidates, remote tracks, data channel traffic) flow through
/// `WebRTCEventBus` → per-LynxView `WebRTCPublisher` → JS
/// `GlobalEventEmitter`. Microphone permission goes through
/// `AVAudioSession.recordPermission`, like `@sigx/lynx-audio`.
@objc class WebRTCModule: NSObject, LynxModule {

    @objc static var name: String { "WebRTC" }

    @objc static var methodLookup: [String: String] {
        [
            "getUserMedia":         NSStringFromSelector(#selector(getUserMedia(_:constraints:callback:))),
            "requestPermission":    NSStringFromSelector(#selector(requestPermission(_:))),
            "getPermissionStatus":  NSStringFromSelector(#selector(getPermissionStatus(_:))),
            "createPeer":           NSStringFromSelector(#selector(createPeer(_:config:callback:))),
            "createOffer":          NSStringFromSelector(#selector(createOffer(_:options:callback:))),
            "createAnswer":         NSStringFromSelector(#selector(createAnswer(_:options:callback:))),
            "setLocalDescription":  NSStringFromSelector(#selector(setLocalDescription(_:desc:callback:))),
            "setRemoteDescription": NSStringFromSelector(#selector(setRemoteDescription(_:desc:callback:))),
            "addIceCandidate":      NSStringFromSelector(#selector(addIceCandidate(_:candidate:callback:))),
            "addTrack":             NSStringFromSelector(#selector(addTrack(_:trackId:streamIds:callback:))),
            "removeTrack":          NSStringFromSelector(#selector(removeTrack(_:senderId:callback:))),
            "createDataChannel":    NSStringFromSelector(#selector(createDataChannel(_:dcId:label:initDict:callback:))),
            "dcSend":               NSStringFromSelector(#selector(dcSend(_:payload:isBinary:callback:))),
            "dcClose":              NSStringFromSelector(#selector(dcClose(_:callback:))),
            "setTrackEnabled":      NSStringFromSelector(#selector(setTrackEnabled(_:enabled:callback:))),
            "stopTrack":            NSStringFromSelector(#selector(stopTrack(_:callback:))),
            "closePeer":            NSStringFromSelector(#selector(closePeer(_:callback:))),
            "setAudioOutput":       NSStringFromSelector(#selector(setAudioOutput(_:callback:))),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    // MARK: - Media

    // `constraints` keeps the JS-callable selector; v1 captures with platform defaults.
    @objc func getUserMedia(_ trackId: NSNumber, constraints _: [String: Any]?, callback: LynxCallbackBlock?) {
        // Browser semantics: prompt whenever the permission is promptable,
        // resolve immediately when granted, fail fast when denied (iOS never
        // re-prompts — the user must visit Settings).
        let session = AVAudioSession.sharedInstance()
        switch session.recordPermission {
        case .granted:
            callback?(Self.captureResult(trackId: trackId.intValue))
        case .undetermined:
            session.requestRecordPermission { granted in
                if granted {
                    callback?(Self.captureResult(trackId: trackId.intValue))
                } else {
                    callback?(Self.deniedResult())
                }
            }
        default:
            callback?(Self.deniedResult())
        }
    }

    private static func captureResult(trackId: Int) -> [String: Any] {
        if let error = PeerConnectionStore.shared.createMicrophoneTrack(trackId: trackId) {
            return ["error": error]
        }
        return ["label": "microphone"]
    }

    private static func deniedResult() -> [String: Any] {
        return ["error": "Microphone permission not granted", "errorName": "NotAllowedError"]
    }

    @objc func setTrackEnabled(_ trackId: NSNumber, enabled: NSNumber, callback: LynxCallbackBlock?) {
        callback?(Self.result(PeerConnectionStore.shared.setTrackEnabled(
            trackId: trackId.intValue, enabled: enabled.boolValue
        )))
    }

    @objc func stopTrack(_ trackId: NSNumber, callback: LynxCallbackBlock?) {
        callback?(Self.result(PeerConnectionStore.shared.stopTrack(trackId: trackId.intValue)))
    }

    // MARK: - Peer connection

    @objc func createPeer(_ peerId: NSNumber, config: [String: Any]?, callback: LynxCallbackBlock?) {
        callback?(Self.result(PeerConnectionStore.shared.createPeer(peerId: peerId.intValue, config: config)))
    }

    @objc func createOffer(_ peerId: NSNumber, options: [String: Any]?, callback: LynxCallbackBlock?) {
        PeerConnectionStore.shared.createOffer(peerId: peerId.intValue, options: options) { sdp, error in
            callback?(Self.descriptionResult(sdp, error))
        }
    }

    // `options` keeps signature parity with createOffer; answers take none.
    @objc func createAnswer(_ peerId: NSNumber, options _: [String: Any]?, callback: LynxCallbackBlock?) {
        PeerConnectionStore.shared.createAnswer(peerId: peerId.intValue) { sdp, error in
            callback?(Self.descriptionResult(sdp, error))
        }
    }

    @objc func setLocalDescription(_ peerId: NSNumber, desc: [String: Any]?, callback: LynxCallbackBlock?) {
        PeerConnectionStore.shared.setLocalDescription(peerId: peerId.intValue, desc: desc) { applied, error in
            callback?(Self.descriptionResult(applied, error))
        }
    }

    @objc func setRemoteDescription(_ peerId: NSNumber, desc: [String: Any]?, callback: LynxCallbackBlock?) {
        PeerConnectionStore.shared.setRemoteDescription(peerId: peerId.intValue, desc: desc) { error in
            callback?(Self.result(error))
        }
    }

    @objc func addIceCandidate(_ peerId: NSNumber, candidate: [String: Any]?, callback: LynxCallbackBlock?) {
        PeerConnectionStore.shared.addIceCandidate(peerId: peerId.intValue, candidate: candidate) { error in
            callback?(Self.result(error))
        }
    }

    @objc func addTrack(_ peerId: NSNumber, trackId: NSNumber, streamIds: [Any]?, callback: LynxCallbackBlock?) {
        let ids = (streamIds as? [String])?.filter { !$0.isEmpty } ?? []
        let (senderId, error) = PeerConnectionStore.shared.addTrack(
            peerId: peerId.intValue, trackId: trackId.intValue, streamIds: ids
        )
        if let error = error {
            callback?(["error": error])
            return
        }
        callback?(["senderId": senderId])
    }

    @objc func removeTrack(_ peerId: NSNumber, senderId: NSNumber, callback: LynxCallbackBlock?) {
        callback?(Self.result(PeerConnectionStore.shared.removeTrack(
            peerId: peerId.intValue, senderId: senderId.intValue
        )))
    }

    @objc func closePeer(_ peerId: NSNumber, callback: LynxCallbackBlock?) {
        callback?(Self.result(PeerConnectionStore.shared.closePeer(peerId: peerId.intValue)))
    }

    // MARK: - Data channels

    @objc func createDataChannel(_ peerId: NSNumber, dcId: NSNumber, label: String?, initDict: [String: Any]?, callback: LynxCallbackBlock?) {
        callback?(Self.result(PeerConnectionStore.shared.createDataChannel(
            peerId: peerId.intValue, dcId: dcId.intValue, label: label ?? "", initDict: initDict
        )))
    }

    @objc func dcSend(_ dcId: NSNumber, payload: String?, isBinary: NSNumber?, callback: LynxCallbackBlock?) {
        callback?(Self.result(PeerConnectionStore.shared.dcSend(
            dcId: dcId.intValue, payload: payload ?? "", isBinary: isBinary?.boolValue ?? false
        )))
    }

    @objc func dcClose(_ dcId: NSNumber, callback: LynxCallbackBlock?) {
        callback?(Self.result(PeerConnectionStore.shared.dcClose(dcId: dcId.intValue)))
    }

    // MARK: - Audio routing & permission

    @objc func setAudioOutput(_ route: String?, callback: LynxCallbackBlock?) {
        callback?(Self.result(WebRTCAudioController.shared.setRoute(route ?? "")))
    }

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
        switch AVAudioSession.sharedInstance().recordPermission {
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

    // MARK: - Helpers

    private static func result(_ error: String?) -> Any {
        if let error = error { return ["error": error] }
        return [String: Any]()
    }

    private static func descriptionResult(_ sdp: RTCSessionDescription?, _ error: String?) -> Any {
        if let error = error { return ["error": error] }
        guard let sdp = sdp else { return [String: Any]() }
        return ["type": PeerConnectionStore.sdpTypeString(sdp.type), "sdp": sdp.sdp]
    }
}
