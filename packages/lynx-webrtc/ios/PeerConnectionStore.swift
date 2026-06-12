import AVFoundation
import Foundation
import WebRTC

/// Native-side registries and libwebrtc plumbing.
///
/// One process-wide `RTCPeerConnectionFactory` (lazy). Entities are keyed
/// by the JS-supplied positive ids; native-created entities (remote
/// tracks, remote data channels) get negative ids. libwebrtc invokes
/// delegates on its signaling thread — they only touch the lock-guarded
/// registries and `WebRTCEventBus`.
final class PeerConnectionStore {

    static let shared = PeerConnectionStore()

    final class PeerEntry {
        let pc: RTCPeerConnection
        let delegate: PeerDelegate
        var dcIds = Set<Int>()
        var remoteTrackIds = Set<Int>()
        var senderIds = Set<Int>()

        init(pc: RTCPeerConnection, delegate: PeerDelegate) {
            self.pc = pc
            self.delegate = delegate
        }
    }

    final class TrackEntry {
        let track: RTCMediaStreamTrack
        let source: RTCAudioSource?
        let remote: Bool

        init(track: RTCMediaStreamTrack, source: RTCAudioSource?, remote: Bool) {
            self.track = track
            self.source = source
            self.remote = remote
        }
    }

    final class DcEntry {
        let dc: RTCDataChannel
        let delegate: DcDelegate

        init(dc: RTCDataChannel, delegate: DcDelegate) {
            self.dc = dc
            self.delegate = delegate
        }
    }

    private let lock = NSLock()
    private var factory: RTCPeerConnectionFactory?
    private var peers: [Int: PeerEntry] = [:]
    private var tracks: [Int: TrackEntry] = [:]
    private var channels: [Int: DcEntry] = [:]
    private var senders: [Int: RTCRtpSender] = [:]
    /// Ids for native-created entities — counts down so it can never collide with JS ids.
    private var nextNativeId = -1
    /// Sender handles live in their own (positive) space — never used for event demux.
    private var nextSenderId = 1

    private func ensureFactory() -> RTCPeerConnectionFactory {
        lock.lock()
        defer { lock.unlock() }
        if let factory = factory { return factory }
        RTCInitializeSSL()
        WebRTCAudioController.shared.enableManualAudioMode()
        // Default video factories are harmless for audio-only and keep the
        // door open for a video follow-up.
        let f = RTCPeerConnectionFactory(
            encoderFactory: RTCDefaultVideoEncoderFactory(),
            decoderFactory: RTCDefaultVideoDecoderFactory()
        )
        factory = f
        return f
    }

    // MARK: - Media

    /// Create a microphone capture track under the JS-supplied id. Returns an error message or nil.
    func createMicrophoneTrack(trackId: Int) -> String? {
        let f = ensureFactory()
        lock.lock()
        defer { lock.unlock() }
        guard tracks[trackId] == nil else { return "Track \(trackId) already exists" }
        let source = f.audioSource(with: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil))
        let track = f.audioTrack(with: source, trackId: "t\(trackId)")
        tracks[trackId] = TrackEntry(track: track, source: source, remote: false)
        return nil
    }

    func setTrackEnabled(trackId: Int, enabled: Bool) -> String? {
        lock.lock()
        defer { lock.unlock() }
        guard let entry = tracks[trackId] else { return "No track \(trackId)" }
        entry.track.isEnabled = enabled
        return nil
    }

    func stopTrack(trackId: Int) -> String? {
        lock.lock()
        defer { lock.unlock() }
        guard let entry = tracks.removeValue(forKey: trackId) else { return "No track \(trackId)" }
        entry.track.isEnabled = false
        // ARC frees the capturer once the registry reference drops; remote
        // tracks are owned by their receiver and go away with the peer.
        return nil
    }

    // MARK: - Peer lifecycle

    func createPeer(peerId: Int, config: [String: Any]?) -> String? {
        let f = ensureFactory()
        lock.lock()
        guard peers[peerId] == nil else {
            lock.unlock()
            return "Peer \(peerId) already exists"
        }
        lock.unlock()

        let rtcConfig = RTCConfiguration()
        rtcConfig.sdpSemantics = .unifiedPlan
        rtcConfig.iceServers = Self.parseIceServers(config)

        let delegate = PeerDelegate(peerId: peerId)
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        guard let pc = f.peerConnection(with: rtcConfig, constraints: constraints, delegate: delegate) else {
            return "createPeerConnection failed"
        }

        lock.lock()
        peers[peerId] = PeerEntry(pc: pc, delegate: delegate)
        lock.unlock()
        WebRTCAudioController.shared.retain()
        return nil
    }

    func closePeer(peerId: Int) -> String? {
        lock.lock()
        guard let entry = peers.removeValue(forKey: peerId) else {
            lock.unlock()
            return nil // idempotent
        }
        var closingChannels: [RTCDataChannel] = []
        for dcId in entry.dcIds {
            if let dcEntry = channels.removeValue(forKey: dcId) {
                dcEntry.dc.delegate = nil
                closingChannels.append(dcEntry.dc)
            }
        }
        for trackId in entry.remoteTrackIds { tracks.removeValue(forKey: trackId) }
        for senderId in entry.senderIds { senders.removeValue(forKey: senderId) }
        lock.unlock()

        for dc in closingChannels { dc.close() }
        entry.pc.close()
        WebRTCAudioController.shared.release()
        return nil
    }

    // MARK: - SDP

    func createOffer(peerId: Int, options: [String: Any]?, done: @escaping (RTCSessionDescription?, String?) -> Void) {
        guard let entry = peer(peerId) else { return done(nil, "No peer \(peerId)") }
        entry.pc.offer(for: Self.offerConstraints(options)) { sdp, error in
            done(sdp, error?.localizedDescription)
        }
    }

    func createAnswer(peerId: Int, done: @escaping (RTCSessionDescription?, String?) -> Void) {
        guard let entry = peer(peerId) else { return done(nil, "No peer \(peerId)") }
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        entry.pc.answer(for: constraints) { sdp, error in
            done(sdp, error?.localizedDescription)
        }
    }

    /// `desc == nil` is the implicit form; echoes the applied local description.
    func setLocalDescription(peerId: Int, desc: [String: Any]?, done: @escaping (RTCSessionDescription?, String?) -> Void) {
        guard let entry = peer(peerId) else { return done(nil, "No peer \(peerId)") }
        let completion: (Error?) -> Void = { error in
            done(error == nil ? entry.pc.localDescription : nil, error?.localizedDescription)
        }
        if let desc = desc {
            guard let parsed = Self.parseDescription(desc) else { return done(nil, "Invalid session description") }
            entry.pc.setLocalDescription(parsed, completionHandler: completion)
            return
        }
        // Implicit form, spelled out per spec (an answer when a remote offer
        // is pending, an offer otherwise) — keeps us off SDK-version-specific
        // convenience overloads.
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let apply: (RTCSessionDescription?, Error?) -> Void = { sdp, error in
            guard let sdp = sdp else {
                return done(nil, error?.localizedDescription ?? "create failed")
            }
            entry.pc.setLocalDescription(sdp, completionHandler: completion)
        }
        if entry.pc.signalingState == .haveRemoteOffer || entry.pc.signalingState == .haveLocalPrAnswer {
            entry.pc.answer(for: constraints, completionHandler: apply)
        } else {
            entry.pc.offer(for: constraints, completionHandler: apply)
        }
    }

    func setRemoteDescription(peerId: Int, desc: [String: Any]?, done: @escaping (String?) -> Void) {
        guard let entry = peer(peerId) else { return done("No peer \(peerId)") }
        guard let desc = desc, let parsed = Self.parseDescription(desc) else {
            return done("Invalid session description")
        }
        entry.pc.setRemoteDescription(parsed) { error in
            done(error?.localizedDescription)
        }
    }

    func addIceCandidate(peerId: Int, candidate: [String: Any]?, done: @escaping (String?) -> Void) {
        guard let entry = peer(peerId) else { return done("No peer \(peerId)") }
        guard let candidate = candidate else {
            // End-of-candidates marker — nothing to feed libwebrtc.
            return done(nil)
        }
        let sdp = candidate["candidate"] as? String ?? ""
        let sdpMid = candidate["sdpMid"] as? String
        let sdpMLineIndex = (candidate["sdpMLineIndex"] as? NSNumber)?.int32Value ?? 0
        let ice = RTCIceCandidate(sdp: sdp, sdpMLineIndex: sdpMLineIndex, sdpMid: sdpMid)
        entry.pc.add(ice) { error in
            done(error?.localizedDescription)
        }
    }

    // MARK: - Tracks on the wire

    func addTrack(peerId: Int, trackId: Int, streamIds: [String]) -> (senderId: Int, error: String?) {
        lock.lock()
        guard let entry = peers[peerId] else {
            lock.unlock()
            return (0, "No peer \(peerId)")
        }
        guard let trackEntry = tracks[trackId] else {
            lock.unlock()
            return (0, "No track \(trackId)")
        }
        lock.unlock()

        guard let sender = entry.pc.add(trackEntry.track, streamIds: streamIds) else {
            return (0, "addTrack failed")
        }

        lock.lock()
        let senderId = nextSenderId
        nextSenderId += 1
        senders[senderId] = sender
        entry.senderIds.insert(senderId)
        lock.unlock()
        return (senderId, nil)
    }

    func removeTrack(peerId: Int, senderId: Int) -> String? {
        lock.lock()
        guard let entry = peers[peerId] else {
            lock.unlock()
            return "No peer \(peerId)"
        }
        guard let sender = senders.removeValue(forKey: senderId) else {
            lock.unlock()
            return "No sender \(senderId)"
        }
        entry.senderIds.remove(senderId)
        lock.unlock()
        return entry.pc.removeTrack(sender) ? nil : "removeTrack failed"
    }

    // MARK: - Data channels

    func createDataChannel(peerId: Int, dcId: Int, label: String, initDict: [String: Any]?) -> String? {
        guard let entry = peer(peerId) else { return "No peer \(peerId)" }
        let config = RTCDataChannelConfiguration()
        if let initDict = initDict {
            if let ordered = initDict["ordered"] as? Bool { config.isOrdered = ordered }
            if let lifeTime = initDict["maxPacketLifeTime"] as? NSNumber { config.maxPacketLifeTime = lifeTime.int32Value }
            if let retransmits = initDict["maxRetransmits"] as? NSNumber { config.maxRetransmits = retransmits.int32Value }
            if let proto = initDict["protocol"] as? String { config.protocol = proto }
            if let negotiated = initDict["negotiated"] as? Bool { config.isNegotiated = negotiated }
            if let channelId = initDict["id"] as? NSNumber { config.channelId = channelId.int32Value }
        }
        guard let dc = entry.pc.dataChannel(forLabel: label, configuration: config) else {
            return "createDataChannel failed"
        }
        registerChannel(dcId: dcId, dc: dc, peerId: peerId, entry: entry)
        return nil
    }

    func dcSend(dcId: Int, payload: String, isBinary: Bool) -> String? {
        guard let entry = channel(dcId) else { return "No data channel \(dcId)" }
        guard entry.dc.readyState == .open else { return "Data channel \(dcId) is not open" }
        let data: Data
        if isBinary {
            guard let decoded = Data(base64Encoded: payload) else { return "Invalid base64 payload" }
            data = decoded
        } else {
            data = Data(payload.utf8)
        }
        let ok = entry.dc.sendData(RTCDataBuffer(data: data, isBinary: isBinary))
        return ok ? nil : "send failed"
    }

    func dcClose(dcId: Int) -> String? {
        guard let entry = channel(dcId) else { return nil } // idempotent
        entry.dc.close()
        return nil
    }

    // MARK: - Registry plumbing (called from delegates too)

    private func peer(_ peerId: Int) -> PeerEntry? {
        lock.lock()
        defer { lock.unlock() }
        return peers[peerId]
    }

    private func channel(_ dcId: Int) -> DcEntry? {
        lock.lock()
        defer { lock.unlock() }
        return channels[dcId]
    }

    fileprivate func allocNativeId() -> Int {
        lock.lock()
        defer { lock.unlock() }
        let id = nextNativeId
        nextNativeId -= 1
        return id
    }

    fileprivate func registerChannel(dcId: Int, dc: RTCDataChannel, peerId: Int, entry: PeerEntry) {
        let delegate = DcDelegate(dcId: dcId, peerId: peerId)
        lock.lock()
        channels[dcId] = DcEntry(dc: dc, delegate: delegate)
        entry.dcIds.insert(dcId)
        lock.unlock()
        dc.delegate = delegate
        if dc.readyState == .open {
            WebRTCEventBus.shared.publishDcOpen(dcId: dcId, sctpId: Int(dc.channelId))
        }
    }

    fileprivate func registerRemoteTrack(trackId: Int, track: RTCMediaStreamTrack, peerId: Int) {
        lock.lock()
        tracks[trackId] = TrackEntry(track: track, source: nil, remote: true)
        peers[peerId]?.remoteTrackIds.insert(trackId)
        lock.unlock()
    }

    /// Fully release a channel that closed on its own — gated on winning the
    /// registry removal so a racing `closePeer` can't double-release.
    fileprivate func releaseClosedChannel(dcId: Int, peerId: Int) {
        lock.lock()
        let entry = channels.removeValue(forKey: dcId)
        peers[peerId]?.dcIds.remove(dcId)
        lock.unlock()
        entry?.dc.delegate = nil
    }

    // MARK: - Parsing helpers

    private static func parseIceServers(_ config: [String: Any]?) -> [RTCIceServer] {
        guard let list = config?["iceServers"] as? [[String: Any]] else { return [] }
        var servers: [RTCIceServer] = []
        for entry in list {
            let urls = (entry["urls"] as? [String])?.filter { !$0.isEmpty } ?? []
            guard !urls.isEmpty else { continue }
            let username = entry["username"] as? String
            let credential = entry["credential"] as? String
            if username != nil || credential != nil {
                servers.append(RTCIceServer(urlStrings: urls, username: username, credential: credential))
            } else {
                servers.append(RTCIceServer(urlStrings: urls))
            }
        }
        return servers
    }

    private static func parseDescription(_ desc: [String: Any]) -> RTCSessionDescription? {
        guard let typeString = desc["type"] as? String else { return nil }
        let sdp = desc["sdp"] as? String ?? ""
        let type: RTCSdpType
        switch typeString {
        case "offer": type = .offer
        case "answer": type = .answer
        case "pranswer": type = .prAnswer
        case "rollback": type = .rollback
        default: return nil
        }
        return RTCSessionDescription(type: type, sdp: sdp)
    }

    private static func offerConstraints(_ options: [String: Any]?) -> RTCMediaConstraints {
        var mandatory: [String: String] = [:]
        if options?["offerToReceiveAudio"] as? Bool == true { mandatory["OfferToReceiveAudio"] = "true" }
        if options?["iceRestart"] as? Bool == true { mandatory["IceRestart"] = "true" }
        return RTCMediaConstraints(mandatoryConstraints: mandatory.isEmpty ? nil : mandatory, optionalConstraints: nil)
    }

    // MARK: - State string mappings

    static func string(for state: RTCSignalingState) -> String {
        switch state {
        case .stable: return "stable"
        case .haveLocalOffer: return "have-local-offer"
        case .haveLocalPrAnswer: return "have-local-pranswer"
        case .haveRemoteOffer: return "have-remote-offer"
        case .haveRemotePrAnswer: return "have-remote-pranswer"
        case .closed: return "closed"
        @unknown default: return "stable"
        }
    }

    static func string(for state: RTCPeerConnectionState) -> String {
        switch state {
        case .new: return "new"
        case .connecting: return "connecting"
        case .connected: return "connected"
        case .disconnected: return "disconnected"
        case .failed: return "failed"
        case .closed: return "closed"
        @unknown default: return "new"
        }
    }

    static func string(for state: RTCIceConnectionState) -> String {
        switch state {
        case .new: return "new"
        case .checking: return "checking"
        case .connected: return "connected"
        case .completed: return "completed"
        case .disconnected: return "disconnected"
        case .failed: return "failed"
        case .closed: return "closed"
        case .count: return "new"
        @unknown default: return "new"
        }
    }

    static func string(for state: RTCIceGatheringState) -> String {
        switch state {
        case .new: return "new"
        case .gathering: return "gathering"
        case .complete: return "complete"
        @unknown default: return "new"
        }
    }

    static func sdpTypeString(_ type: RTCSdpType) -> String {
        switch type {
        case .offer: return "offer"
        case .answer: return "answer"
        case .prAnswer: return "pranswer"
        case .rollback: return "rollback"
        @unknown default: return "offer"
        }
    }
}

// MARK: - Peer delegate (libwebrtc signaling thread → event bus)

final class PeerDelegate: NSObject, RTCPeerConnectionDelegate {

    private let peerId: Int

    init(peerId: Int) {
        self.peerId = peerId
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {
        WebRTCEventBus.shared.publishStateChange(
            peerId: peerId,
            type: "signalingstatechange",
            state: PeerConnectionStore.string(for: stateChanged)
        )
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {
        WebRTCEventBus.shared.publishStateChange(
            peerId: peerId,
            type: "connectionstatechange",
            state: PeerConnectionStore.string(for: newState)
        )
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        WebRTCEventBus.shared.publishStateChange(
            peerId: peerId,
            type: "iceconnectionstatechange",
            state: PeerConnectionStore.string(for: newState)
        )
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {
        // Piggy-back the current local SDP so the JS-side localDescription
        // cache carries all candidates once gathering completes.
        let local = peerConnection.localDescription
        WebRTCEventBus.shared.publishIceGatheringChange(
            peerId: peerId,
            state: PeerConnectionStore.string(for: newState),
            sdpType: local.map { PeerConnectionStore.sdpTypeString($0.type) },
            sdp: local?.sdp
        )
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        WebRTCEventBus.shared.publishIceCandidate(
            peerId: peerId,
            candidate: candidate.sdp,
            sdpMid: candidate.sdpMid,
            sdpMLineIndex: Int(candidate.sdpMLineIndex)
        )
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}

    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {
        let store = PeerConnectionStore.shared
        guard let entry = storeEntry() else { return }
        let dcId = store.allocNativeId()
        WebRTCEventBus.shared.publishDataChannel(peerId: peerId, dcId: dcId, label: dataChannel.label)
        // Register after announcing so dcopen (if already open) follows the
        // datachannel event, matching the JS contract.
        store.registerChannel(dcId: dcId, dc: dataChannel, peerId: peerId, entry: entry)
    }

    func peerConnection(
        _ peerConnection: RTCPeerConnection,
        didAdd rtpReceiver: RTCRtpReceiver,
        streams mediaStreams: [RTCMediaStream]
    ) {
        guard let track = rtpReceiver.track else { return }
        let store = PeerConnectionStore.shared
        let trackId = store.allocNativeId()
        store.registerRemoteTrack(trackId: trackId, track: track, peerId: peerId)
        WebRTCEventBus.shared.publishTrack(
            peerId: peerId,
            trackId: trackId,
            kind: track.kind == "audio" ? "audio" : "video",
            label: track.trackId,
            streamIds: mediaStreams.map { $0.streamId },
            muted: false
        )
    }

    private func storeEntry() -> PeerConnectionStore.PeerEntry? {
        // Mirror lookup goes through the store's lock.
        return PeerConnectionStore.shared.entryForDelegate(peerId: peerId)
    }
}

extension PeerConnectionStore {
    fileprivate func entryForDelegate(peerId: Int) -> PeerEntry? {
        lock.lock()
        defer { lock.unlock() }
        return peers[peerId]
    }
}

// MARK: - Data channel delegate

final class DcDelegate: NSObject, RTCDataChannelDelegate {

    private let dcId: Int
    private let peerId: Int

    init(dcId: Int, peerId: Int) {
        self.dcId = dcId
        self.peerId = peerId
    }

    func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
        switch dataChannel.readyState {
        case .open:
            WebRTCEventBus.shared.publishDcOpen(dcId: dcId, sctpId: Int(dataChannel.channelId))
        case .closed:
            WebRTCEventBus.shared.publishDcClose(dcId: dcId)
            PeerConnectionStore.shared.releaseClosedChannel(dcId: dcId, peerId: peerId)
        default:
            break
        }
    }

    func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        if buffer.isBinary {
            WebRTCEventBus.shared.publishDcMessageBinary(dcId: dcId, base64: buffer.data.base64EncodedString())
        } else {
            let text = String(data: buffer.data, encoding: .utf8) ?? ""
            WebRTCEventBus.shared.publishDcMessageText(dcId: dcId, text: text)
        }
    }
}
