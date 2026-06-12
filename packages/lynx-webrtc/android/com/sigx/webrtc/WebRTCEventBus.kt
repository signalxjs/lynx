package com.sigx.webrtc

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Process-wide pub/sub bus that converts libwebrtc callbacks into JS-side
 * event payloads. WebRTC observers (signaling thread) write here;
 * per-LynxView [WebRTCPublisher] instances read.
 *
 * Payloads are emitted as JSON **strings**, not structured maps: Lynx
 * 0.5.0's bridge drops sibling scalar fields when a map carries a nested
 * map (#342), and WebRTC events nest objects (`candidate`). A string
 * survives marshalling intact — the JS shim already parses string events
 * (same workaround as `HttpEventBus`).
 *
 * Payload keys match the `NativeEvent` interface in `src/events.ts`.
 * Demux key is `id`: positive ids belong to JS-created entities (peers,
 * local tracks, local data channels), negative ids to native-created ones
 * (remote tracks, remote data channels).
 */
internal object WebRTCEventBus {

    private val listeners = CopyOnWriteArrayList<Pair<UUID, (String) -> Unit>>()

    fun addListener(fn: (String) -> Unit): UUID {
        val token = UUID.randomUUID()
        listeners.add(token to fn)
        return token
    }

    fun removeListener(token: UUID) {
        listeners.removeAll { it.first == token }
    }

    // MARK: - Peer connection events

    fun publishStateChange(peerId: Int, type: String, state: String) {
        emit(
            JSONObject()
                .put("id", peerId)
                .put("type", type)
                .put("state", state)
        )
    }

    /** Gathering-state change carries the current local SDP so the JS shim can cache it. */
    fun publishIceGatheringChange(peerId: Int, state: String, sdpType: String?, sdp: String?) {
        emit(
            JSONObject()
                .put("id", peerId)
                .put("type", "icegatheringstatechange")
                .put("state", state)
                .putOpt("sdpType", sdpType)
                .putOpt("sdp", sdp)
        )
    }

    fun publishIceCandidate(peerId: Int, candidate: String, sdpMid: String?, sdpMLineIndex: Int) {
        emit(
            JSONObject()
                .put("id", peerId)
                .put("type", "icecandidate")
                .put(
                    "candidate",
                    JSONObject()
                        .put("candidate", candidate)
                        .putOpt("sdpMid", sdpMid)
                        .put("sdpMLineIndex", sdpMLineIndex)
                )
        )
    }

    fun publishEndOfCandidates(peerId: Int) {
        // No "candidate" key — the JS shim coalesces the absent field to null.
        emit(
            JSONObject()
                .put("id", peerId)
                .put("type", "icecandidate")
        )
    }

    fun publishTrack(
        peerId: Int,
        trackId: Int,
        kind: String,
        label: String,
        streamIds: List<String>,
        muted: Boolean,
    ) {
        emit(
            JSONObject()
                .put("id", peerId)
                .put("type", "track")
                .put("trackId", trackId)
                .put("trackKind", kind)
                .put("trackLabel", label)
                .put("streamIds", JSONArray(streamIds))
                .put("muted", muted)
        )
    }

    /**
     * `ordered` / `protocol` are intentionally absent — the Android SDK does
     * not expose them on a received channel, so rather than asserting
     * placeholders the JS shim applies its own defaults.
     */
    fun publishDataChannel(peerId: Int, dcId: Int, label: String) {
        emit(
            JSONObject()
                .put("id", peerId)
                .put("type", "datachannel")
                .put("dcId", dcId)
                .put("label", label)
        )
    }

    // MARK: - Data channel events

    fun publishDcOpen(dcId: Int, sctpId: Int) {
        emit(
            JSONObject()
                .put("id", dcId)
                .put("type", "dcopen")
                .put("sctpId", sctpId)
        )
    }

    fun publishDcMessageText(dcId: Int, text: String) {
        emit(
            JSONObject()
                .put("id", dcId)
                .put("type", "dcmessage")
                .put("data", text)
                .put("isBinary", false)
        )
    }

    fun publishDcMessageBinary(dcId: Int, base64: String) {
        emit(
            JSONObject()
                .put("id", dcId)
                .put("type", "dcmessage")
                .put("binary", base64)
                .put("isBinary", true)
        )
    }

    fun publishDcError(dcId: Int, message: String) {
        emit(
            JSONObject()
                .put("id", dcId)
                .put("type", "dcerror")
                .put("message", message)
        )
    }

    fun publishDcClose(dcId: Int) {
        emit(
            JSONObject()
                .put("id", dcId)
                .put("type", "dcclose")
        )
    }

    // MARK: - Track events

    fun publishTrackEnded(trackId: Int) {
        emit(
            JSONObject()
                .put("id", trackId)
                .put("type", "trackended")
        )
    }

    private fun emit(payload: JSONObject) {
        val json = payload.toString()
        for ((_, fn) in listeners) fn(json)
    }
}
