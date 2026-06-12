import Foundation

/// Process-wide pub/sub bus that converts libwebrtc callbacks into JS-side
/// event payloads. WebRTC delegates (signaling thread) write here;
/// per-LynxView `WebRTCPublisher` instances read.
///
/// Payloads are emitted as JSON **strings**, not structured dictionaries:
/// Lynx 0.5.0's bridge drops sibling scalar fields when a map carries a
/// nested map (#342), and WebRTC events nest objects (`candidate`). A
/// string survives marshalling intact — the JS shim already parses string
/// events (same workaround as `HttpEventBus`).
///
/// Payload keys match the `NativeEvent` interface in `src/events.ts`.
/// Demux key is `id`: positive ids belong to JS-created entities (peers,
/// local tracks, local data channels), negative ids to native-created
/// ones (remote tracks, remote data channels).
final class WebRTCEventBus {

    static let shared = WebRTCEventBus()

    typealias Listener = (String) -> Void

    private let queue = DispatchQueue(label: "com.sigx.webrtc.bus")
    private var listeners: [(token: UUID, fn: Listener)] = []

    @discardableResult
    func addListener(_ fn: @escaping Listener) -> UUID {
        let token = UUID()
        queue.sync { listeners.append((token, fn)) }
        return token
    }

    func removeListener(_ token: UUID) {
        queue.sync { listeners.removeAll { $0.token == token } }
    }

    // MARK: - Peer connection events

    func publishStateChange(peerId: Int, type: String, state: String) {
        emit(["id": peerId, "type": type, "state": state])
    }

    /// Gathering-state change carries the current local SDP so the JS shim can cache it.
    func publishIceGatheringChange(peerId: Int, state: String, sdpType: String?, sdp: String?) {
        var payload: [String: Any] = ["id": peerId, "type": "icegatheringstatechange", "state": state]
        if let sdpType = sdpType { payload["sdpType"] = sdpType }
        if let sdp = sdp { payload["sdp"] = sdp }
        emit(payload)
    }

    func publishIceCandidate(peerId: Int, candidate: String, sdpMid: String?, sdpMLineIndex: Int) {
        var cand: [String: Any] = ["candidate": candidate, "sdpMLineIndex": sdpMLineIndex]
        if let sdpMid = sdpMid { cand["sdpMid"] = sdpMid }
        emit(["id": peerId, "type": "icecandidate", "candidate": cand])
    }

    func publishEndOfCandidates(peerId: Int) {
        // No "candidate" key — the JS shim coalesces the absent field to null.
        emit(["id": peerId, "type": "icecandidate"])
    }

    func publishTrack(peerId: Int, trackId: Int, kind: String, label: String, streamIds: [String], muted: Bool) {
        emit([
            "id": peerId,
            "type": "track",
            "trackId": trackId,
            "trackKind": kind,
            "trackLabel": label,
            "streamIds": streamIds,
            "muted": muted,
        ])
    }

    /// `ordered` / `protocol` are intentionally absent — not exposed by the
    /// SDK on a received channel, so the JS shim applies its own defaults.
    func publishDataChannel(peerId: Int, dcId: Int, label: String) {
        emit(["id": peerId, "type": "datachannel", "dcId": dcId, "label": label])
    }

    // MARK: - Data channel events

    func publishDcOpen(dcId: Int, sctpId: Int) {
        emit(["id": dcId, "type": "dcopen", "sctpId": sctpId])
    }

    func publishDcMessageText(dcId: Int, text: String) {
        emit(["id": dcId, "type": "dcmessage", "data": text, "isBinary": false])
    }

    func publishDcMessageBinary(dcId: Int, base64: String) {
        emit(["id": dcId, "type": "dcmessage", "binary": base64, "isBinary": true])
    }

    func publishDcError(dcId: Int, message: String) {
        emit(["id": dcId, "type": "dcerror", "message": message])
    }

    func publishDcClose(dcId: Int) {
        emit(["id": dcId, "type": "dcclose"])
    }

    // MARK: - Track events

    func publishTrackEnded(trackId: Int) {
        emit(["id": trackId, "type": "trackended"])
    }

    private func emit(_ payload: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else {
            NSLog("[lynx-webrtc] dropped unencodable event payload")
            return
        }
        let snapshot = queue.sync { listeners }
        for (_, fn) in snapshot { fn(json) }
    }
}
