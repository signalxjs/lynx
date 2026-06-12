package com.sigx.webrtc

import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Process-wide pub/sub bus that converts libwebrtc callbacks into JS-side
 * event payloads. WebRTC observers (signaling thread) write here;
 * per-LynxView [WebRTCPublisher] instances read.
 *
 * Payload keys match the `NativeEvent` interface in `src/events.ts`.
 * Demux key is `id`: positive ids belong to JS-created entities (peers,
 * local tracks, local data channels), negative ids to native-created ones
 * (remote tracks, remote data channels).
 */
internal object WebRTCEventBus {

    private val listeners = CopyOnWriteArrayList<Pair<UUID, (JavaOnlyMap) -> Unit>>()

    fun addListener(fn: (JavaOnlyMap) -> Unit): UUID {
        val token = UUID.randomUUID()
        listeners.add(token to fn)
        return token
    }

    fun removeListener(token: UUID) {
        listeners.removeAll { it.first == token }
    }

    // MARK: - Peer connection events

    fun publishStateChange(peerId: Int, type: String, state: String) {
        emit(JavaOnlyMap().apply {
            putInt("id", peerId)
            putString("type", type)
            putString("state", state)
        })
    }

    /** Gathering-state change carries the current local SDP so the JS shim can cache it. */
    fun publishIceGatheringChange(peerId: Int, state: String, sdpType: String?, sdp: String?) {
        emit(JavaOnlyMap().apply {
            putInt("id", peerId)
            putString("type", "icegatheringstatechange")
            putString("state", state)
            if (sdpType != null) putString("sdpType", sdpType)
            if (sdp != null) putString("sdp", sdp)
        })
    }

    fun publishIceCandidate(peerId: Int, candidate: String, sdpMid: String?, sdpMLineIndex: Int) {
        emit(JavaOnlyMap().apply {
            putInt("id", peerId)
            putString("type", "icecandidate")
            putMap("candidate", JavaOnlyMap().apply {
                putString("candidate", candidate)
                if (sdpMid != null) putString("sdpMid", sdpMid)
                putInt("sdpMLineIndex", sdpMLineIndex)
            })
        })
    }

    fun publishEndOfCandidates(peerId: Int) {
        // No "candidate" key — the JS shim coalesces the absent field to null.
        emit(JavaOnlyMap().apply {
            putInt("id", peerId)
            putString("type", "icecandidate")
        })
    }

    fun publishTrack(
        peerId: Int,
        trackId: Int,
        kind: String,
        label: String,
        streamIds: List<String>,
        muted: Boolean,
    ) {
        emit(JavaOnlyMap().apply {
            putInt("id", peerId)
            putString("type", "track")
            putInt("trackId", trackId)
            putString("trackKind", kind)
            putString("trackLabel", label)
            putArray("streamIds", JavaOnlyArray().apply { streamIds.forEach { pushString(it) } })
            putBoolean("muted", muted)
        })
    }

    fun publishDataChannel(
        peerId: Int,
        dcId: Int,
        label: String,
        protocol: String,
        ordered: Boolean,
        sctpId: Int,
    ) {
        emit(JavaOnlyMap().apply {
            putInt("id", peerId)
            putString("type", "datachannel")
            putInt("dcId", dcId)
            putString("label", label)
            putString("protocol", protocol)
            putBoolean("ordered", ordered)
            putInt("sctpId", sctpId)
        })
    }

    // MARK: - Data channel events

    fun publishDcOpen(dcId: Int, sctpId: Int) {
        emit(JavaOnlyMap().apply {
            putInt("id", dcId)
            putString("type", "dcopen")
            putInt("sctpId", sctpId)
        })
    }

    fun publishDcMessageText(dcId: Int, text: String) {
        emit(JavaOnlyMap().apply {
            putInt("id", dcId)
            putString("type", "dcmessage")
            putString("data", text)
            putBoolean("isBinary", false)
        })
    }

    fun publishDcMessageBinary(dcId: Int, base64: String) {
        emit(JavaOnlyMap().apply {
            putInt("id", dcId)
            putString("type", "dcmessage")
            putString("binary", base64)
            putBoolean("isBinary", true)
        })
    }

    fun publishDcError(dcId: Int, message: String) {
        emit(JavaOnlyMap().apply {
            putInt("id", dcId)
            putString("type", "dcerror")
            putString("message", message)
        })
    }

    fun publishDcClose(dcId: Int) {
        emit(JavaOnlyMap().apply {
            putInt("id", dcId)
            putString("type", "dcclose")
        })
    }

    // MARK: - Track events

    fun publishTrackEnded(trackId: Int) {
        emit(JavaOnlyMap().apply {
            putInt("id", trackId)
            putString("type", "trackended")
        })
    }

    private fun emit(payload: JavaOnlyMap) {
        for ((_, fn) in listeners) fn(payload)
    }
}
