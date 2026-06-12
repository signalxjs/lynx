package com.sigx.webrtc

import android.content.Context
import android.util.Base64
import android.util.Log
import com.lynx.react.bridge.ReadableMap
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.RtpSender
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.audio.JavaAudioDeviceModule

/**
 * Native-side registries and libwebrtc plumbing.
 *
 * One process-wide [PeerConnectionFactory] (lazy, app context). Entities
 * are keyed by the JS-supplied positive ids; native-created entities
 * (remote tracks, remote data channels) get negative ids from
 * [nativeIds]. libwebrtc invokes observers on its signaling thread — they
 * only touch the concurrent registries and [WebRTCEventBus].
 */
internal object PeerConnectionStore {

    private const val TAG = "SigxWebRTCStore"

    private var factory: PeerConnectionFactory? = null

    private class PeerEntry(val pc: PeerConnection) {
        val dcIds: MutableSet<Int> = ConcurrentHashMap.newKeySet()
        val remoteTrackIds: MutableSet<Int> = ConcurrentHashMap.newKeySet()
        val senderIds: MutableSet<Int> = ConcurrentHashMap.newKeySet()
    }

    private class TrackEntry(
        val track: MediaStreamTrack,
        val source: AudioSource?,
        val remote: Boolean,
    )

    private class DcEntry(val dc: DataChannel, val observer: DataChannel.Observer)

    private val peers = ConcurrentHashMap<Int, PeerEntry>()
    private val tracks = ConcurrentHashMap<Int, TrackEntry>()
    private val channels = ConcurrentHashMap<Int, DcEntry>()
    private val senders = ConcurrentHashMap<Int, RtpSender>()

    /** Ids for native-created entities — counts down so it can never collide with JS ids. */
    private val nativeIds = AtomicInteger(-1)

    /** Sender handles live in their own (positive) space — never used for event demux. */
    private val senderIds = AtomicInteger(1)

    /**
     * Disposal of channels that closed on their own runs here — never on the
     * WebRTC signaling thread that is delivering the state callback.
     */
    private val cleanupExecutor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "sigx-webrtc-cleanup")
    }

    @Synchronized
    private fun ensureFactory(context: Context): PeerConnectionFactory {
        factory?.let { return it }
        val appContext = context.applicationContext
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(appContext)
                .createInitializationOptions()
        )
        val adm = JavaAudioDeviceModule.builder(appContext)
            .setUseHardwareAcousticEchoCanceler(
                JavaAudioDeviceModule.isBuiltInAcousticEchoCancelerSupported()
            )
            .setUseHardwareNoiseSuppressor(
                JavaAudioDeviceModule.isBuiltInNoiseSuppressorSupported()
            )
            .createAudioDeviceModule()
        val f = PeerConnectionFactory.builder()
            .setAudioDeviceModule(adm)
            .createPeerConnectionFactory()
        adm.release()
        factory = f
        return f
    }

    // MARK: - Media

    /** Create a microphone capture track under the JS-supplied id. Returns an error message or null. */
    fun createMicrophoneTrack(context: Context, trackId: Int): String? {
        if (tracks.containsKey(trackId)) return "Track $trackId already exists"
        return try {
            val f = ensureFactory(context)
            val source = f.createAudioSource(MediaConstraints())
            val track = f.createAudioTrack("t$trackId", source)
            tracks[trackId] = TrackEntry(track, source, remote = false)
            null
        } catch (e: Exception) {
            Log.e(TAG, "createMicrophoneTrack($trackId) failed", e)
            e.message ?: "Microphone capture failed"
        }
    }

    fun setTrackEnabled(trackId: Int, enabled: Boolean): String? {
        val entry = tracks[trackId] ?: return "No track $trackId"
        entry.track.setEnabled(enabled)
        return null
    }

    fun stopTrack(trackId: Int): String? {
        val entry = tracks.remove(trackId) ?: return "No track $trackId"
        try {
            entry.track.setEnabled(false)
            if (!entry.remote) {
                // Local capture: we own the track and its source.
                entry.track.dispose()
                entry.source?.dispose()
            }
            // Remote tracks are owned by their receiver — pc disposal frees them.
        } catch (e: Exception) {
            Log.w(TAG, "stopTrack($trackId): ${e.message}")
        }
        return null
    }

    // MARK: - Peer lifecycle

    fun createPeer(context: Context, peerId: Int, config: ReadableMap?): String? {
        if (peers.containsKey(peerId)) return "Peer $peerId already exists"
        val f = ensureFactory(context)
        val rtcConfig = PeerConnection.RTCConfiguration(parseIceServers(config)).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        val pc = f.createPeerConnection(rtcConfig, PeerObserver(peerId))
            ?: return "createPeerConnection failed"
        peers[peerId] = PeerEntry(pc)
        WebRTCAudioController.retain(context)
        return null
    }

    fun closePeer(context: Context, peerId: Int): String? {
        val entry = peers.remove(peerId) ?: return null // idempotent
        for (dcId in entry.dcIds) {
            channels.remove(dcId)?.let { dcEntry ->
                runCatching { dcEntry.dc.unregisterObserver() }
                runCatching { dcEntry.dc.close() }
                runCatching { dcEntry.dc.dispose() }
            }
        }
        for (trackId in entry.remoteTrackIds) tracks.remove(trackId)
        for (senderId in entry.senderIds) senders.remove(senderId)
        runCatching { entry.pc.close() }
        runCatching { entry.pc.dispose() }
        WebRTCAudioController.release(context)
        return null
    }

    // MARK: - SDP

    fun createOffer(peerId: Int, options: ReadableMap?, done: (SessionDescription?, String?) -> Unit) {
        val entry = peers[peerId] ?: return done(null, "No peer $peerId")
        entry.pc.createOffer(sdpCreateObserver(done), offerConstraints(options))
    }

    fun createAnswer(peerId: Int, done: (SessionDescription?, String?) -> Unit) {
        val entry = peers[peerId] ?: return done(null, "No peer $peerId")
        entry.pc.createAnswer(sdpCreateObserver(done), MediaConstraints())
    }

    /** `desc == null` is the implicit form; echoes the applied local description. */
    fun setLocalDescription(peerId: Int, desc: ReadableMap?, done: (SessionDescription?, String?) -> Unit) {
        val entry = peers[peerId] ?: return done(null, "No peer $peerId")
        val observer = sdpSetObserver { error ->
            done(if (error == null) entry.pc.localDescription else null, error)
        }
        if (desc == null) {
            entry.pc.setLocalDescription(observer)
        } else {
            val parsed = parseDescription(desc) ?: return done(null, "Invalid session description")
            entry.pc.setLocalDescription(observer, parsed)
        }
    }

    fun setRemoteDescription(peerId: Int, desc: ReadableMap?, done: (String?) -> Unit) {
        val entry = peers[peerId] ?: return done("No peer $peerId")
        val parsed = parseDescription(desc) ?: return done("Invalid session description")
        entry.pc.setRemoteDescription(sdpSetObserver(done), parsed)
    }

    fun addIceCandidate(peerId: Int, candidate: ReadableMap?, done: (String?) -> Unit) {
        val entry = peers[peerId] ?: return done("No peer $peerId")
        if (candidate == null) {
            // End-of-candidates marker — nothing to feed libwebrtc.
            return done(null)
        }
        val sdp = if (candidate.hasKey("candidate")) candidate.getString("candidate") ?: "" else ""
        val sdpMid = if (candidate.hasKey("sdpMid")) candidate.getString("sdpMid") else null
        val sdpMLineIndex =
            if (candidate.hasKey("sdpMLineIndex")) candidate.getInt("sdpMLineIndex") else 0
        entry.pc.addIceCandidate(IceCandidate(sdpMid, sdpMLineIndex, sdp))
        done(null)
    }

    // MARK: - Tracks on the wire

    fun addTrack(peerId: Int, trackId: Int, streamIds: List<String>): Pair<Int, String?> {
        val entry = peers[peerId] ?: return 0 to "No peer $peerId"
        val trackEntry = tracks[trackId] ?: return 0 to "No track $trackId"
        return try {
            val sender = entry.pc.addTrack(trackEntry.track, streamIds)
            val senderId = senderIds.getAndIncrement()
            senders[senderId] = sender
            entry.senderIds.add(senderId)
            senderId to null
        } catch (e: Exception) {
            0 to (e.message ?: "addTrack failed")
        }
    }

    fun removeTrack(peerId: Int, senderId: Int): String? {
        val entry = peers[peerId] ?: return "No peer $peerId"
        val sender = senders.remove(senderId) ?: return "No sender $senderId"
        entry.senderIds.remove(senderId)
        return try {
            entry.pc.removeTrack(sender)
            null
        } catch (e: Exception) {
            e.message ?: "removeTrack failed"
        }
    }

    // MARK: - Data channels

    fun createDataChannel(peerId: Int, dcId: Int, label: String, init: ReadableMap?): String? {
        val entry = peers[peerId] ?: return "No peer $peerId"
        val dcInit = DataChannel.Init().apply {
            if (init != null) {
                if (init.hasKey("ordered")) ordered = init.getBoolean("ordered")
                if (init.hasKey("maxPacketLifeTime")) maxRetransmitTimeMs = init.getInt("maxPacketLifeTime")
                if (init.hasKey("maxRetransmits")) maxRetransmits = init.getInt("maxRetransmits")
                if (init.hasKey("protocol")) protocol = init.getString("protocol") ?: ""
                if (init.hasKey("negotiated")) negotiated = init.getBoolean("negotiated")
                if (init.hasKey("id")) id = init.getInt("id")
            }
        }
        val dc = entry.pc.createDataChannel(label, dcInit)
            ?: return "createDataChannel failed"
        registerChannel(dcId, dc, peerId, entry)
        return null
    }

    fun dcSend(dcId: Int, payload: String, isBinary: Boolean): String? {
        val entry = channels[dcId] ?: return "No data channel $dcId"
        if (entry.dc.state() != DataChannel.State.OPEN) {
            return "Data channel $dcId is not open"
        }
        val bytes = if (isBinary) {
            try {
                Base64.decode(payload, Base64.DEFAULT)
            } catch (e: IllegalArgumentException) {
                return "Invalid base64 payload"
            }
        } else {
            payload.toByteArray(Charsets.UTF_8)
        }
        val ok = entry.dc.send(DataChannel.Buffer(ByteBuffer.wrap(bytes), isBinary))
        return if (ok) null else "send failed"
    }

    fun dcClose(dcId: Int): String? {
        val entry = channels[dcId] ?: return null // idempotent
        runCatching { entry.dc.close() }
        return null
    }

    // MARK: - Internals

    private fun registerChannel(dcId: Int, dc: DataChannel, peerId: Int, peerEntry: PeerEntry) {
        val observer = DcObserver(dcId, dc, peerId)
        channels[dcId] = DcEntry(dc, observer)
        peerEntry.dcIds.add(dcId)
        dc.registerObserver(observer)
        if (dc.state() == DataChannel.State.OPEN) {
            WebRTCEventBus.publishDcOpen(dcId, dc.id())
        }
    }

    private fun offerConstraints(options: ReadableMap?): MediaConstraints {
        val constraints = MediaConstraints()
        if (options != null) {
            if (options.hasKey("offerToReceiveAudio") && options.getBoolean("offerToReceiveAudio")) {
                constraints.mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
            }
            if (options.hasKey("iceRestart") && options.getBoolean("iceRestart")) {
                constraints.mandatory.add(MediaConstraints.KeyValuePair("IceRestart", "true"))
            }
        }
        return constraints
    }

    private fun parseIceServers(config: ReadableMap?): List<PeerConnection.IceServer> {
        val servers = mutableListOf<PeerConnection.IceServer>()
        val list = (if (config?.hasKey("iceServers") == true) config.getArray("iceServers") else null)
            ?: return servers
        for (i in 0 until list.size()) {
            val entry = list.getMap(i) ?: continue
            val urlsArr = if (entry.hasKey("urls")) entry.getArray("urls") else null
            val urls = mutableListOf<String>()
            for (j in 0 until (urlsArr?.size() ?: 0)) {
                urlsArr!!.getString(j)?.let { if (it.isNotEmpty()) urls.add(it) }
            }
            if (urls.isEmpty()) continue
            val builder = PeerConnection.IceServer.builder(urls)
            if (entry.hasKey("username")) entry.getString("username")?.let { builder.setUsername(it) }
            if (entry.hasKey("credential")) entry.getString("credential")?.let { builder.setPassword(it) }
            servers.add(builder.createIceServer())
        }
        return servers
    }

    private fun parseDescription(desc: ReadableMap?): SessionDescription? {
        if (desc == null) return null
        val type = if (desc.hasKey("type")) desc.getString("type") else null
        val sdp = if (desc.hasKey("sdp")) desc.getString("sdp") ?: "" else ""
        val parsedType = when (type) {
            "offer" -> SessionDescription.Type.OFFER
            "answer" -> SessionDescription.Type.ANSWER
            "pranswer" -> SessionDescription.Type.PRANSWER
            "rollback" -> SessionDescription.Type.ROLLBACK
            else -> return null
        }
        return SessionDescription(parsedType, sdp)
    }

    private fun sdpCreateObserver(done: (SessionDescription?, String?) -> Unit): SdpObserver =
        object : SdpObserver {
            override fun onCreateSuccess(desc: SessionDescription) = done(desc, null)
            override fun onCreateFailure(error: String?) = done(null, error ?: "create failed")
            override fun onSetSuccess() {}
            override fun onSetFailure(error: String?) {}
        }

    private fun sdpSetObserver(done: (String?) -> Unit): SdpObserver =
        object : SdpObserver {
            override fun onCreateSuccess(desc: SessionDescription) {}
            override fun onCreateFailure(error: String?) {}
            override fun onSetSuccess() = done(null)
            override fun onSetFailure(error: String?) = done(error ?: "set failed")
        }

    /** libwebrtc → event bus. Runs on the WebRTC signaling thread. */
    private class PeerObserver(private val peerId: Int) : PeerConnection.Observer {

        override fun onSignalingChange(state: PeerConnection.SignalingState?) {
            state ?: return
            WebRTCEventBus.publishStateChange(
                peerId,
                "signalingstatechange",
                state.name.lowercase().replace('_', '-'),
            )
        }

        override fun onConnectionChange(state: PeerConnection.PeerConnectionState?) {
            state ?: return
            WebRTCEventBus.publishStateChange(peerId, "connectionstatechange", state.name.lowercase())
        }

        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
            state ?: return
            WebRTCEventBus.publishStateChange(
                peerId,
                "iceconnectionstatechange",
                state.name.lowercase(),
            )
        }

        override fun onIceConnectionReceivingChange(receiving: Boolean) {}

        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {
            state ?: return
            // Piggy-back the current local SDP so the JS-side localDescription
            // cache carries all candidates once gathering completes.
            val local = peers[peerId]?.pc?.localDescription
            WebRTCEventBus.publishIceGatheringChange(
                peerId,
                state.name.lowercase(),
                local?.type?.canonicalForm(),
                local?.description,
            )
        }

        override fun onIceCandidate(candidate: IceCandidate?) {
            candidate ?: return WebRTCEventBus.publishEndOfCandidates(peerId)
            WebRTCEventBus.publishIceCandidate(
                peerId,
                candidate.sdp,
                candidate.sdpMid,
                candidate.sdpMLineIndex,
            )
        }

        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}

        override fun onAddStream(stream: MediaStream?) {}

        override fun onRemoveStream(stream: MediaStream?) {}

        override fun onDataChannel(dc: DataChannel?) {
            dc ?: return
            val entry = peers[peerId] ?: return
            val dcId = nativeIds.getAndDecrement()
            WebRTCEventBus.publishDataChannel(
                peerId,
                dcId,
                dc.label() ?: "",
                "", // protocol is not exposed by the Android SDK
                true,
                dc.id(),
            )
            // Register after announcing so dcopen (if already open) follows the
            // datachannel event, matching the JS contract.
            registerChannel(dcId, dc, peerId, entry)
        }

        override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {
            val track = receiver?.track() ?: return
            val entry = peers[peerId] ?: return
            val trackId = nativeIds.getAndDecrement()
            tracks[trackId] = TrackEntry(track, source = null, remote = true)
            entry.remoteTrackIds.add(trackId)
            WebRTCEventBus.publishTrack(
                peerId,
                trackId,
                if (track is AudioTrack) "audio" else "video",
                track.id() ?: "",
                streams?.map { it.id } ?: emptyList(),
                muted = false,
            )
        }

        override fun onRenegotiationNeeded() {}
    }

    /** Data channel callbacks → event bus. Runs on the WebRTC signaling thread. */
    private class DcObserver(
        private val dcId: Int,
        private val dc: DataChannel,
        private val peerId: Int,
    ) : DataChannel.Observer {

        override fun onBufferedAmountChange(previousAmount: Long) {}

        override fun onStateChange() {
            when (dc.state()) {
                DataChannel.State.OPEN -> WebRTCEventBus.publishDcOpen(dcId, dc.id())
                DataChannel.State.CLOSED -> {
                    WebRTCEventBus.publishDcClose(dcId)
                    // Fully release the channel so long-lived peers don't
                    // accumulate closed channels. Disposal is deferred off
                    // this (signaling) thread, which is mid-callback, and
                    // gated on winning the registry removal so a racing
                    // closePeer() can't dispose the same channel twice.
                    val won = channels.remove(dcId) != null
                    peers[peerId]?.dcIds?.remove(dcId)
                    if (won) {
                        cleanupExecutor.execute {
                            runCatching { dc.unregisterObserver() }
                            runCatching { dc.dispose() }
                        }
                    }
                }
                else -> {}
            }
        }

        override fun onMessage(buffer: DataChannel.Buffer?) {
            buffer ?: return
            // Copy out of the direct buffer — libwebrtc reuses it after we return.
            val bytes = ByteArray(buffer.data.remaining())
            buffer.data.get(bytes)
            if (buffer.binary) {
                WebRTCEventBus.publishDcMessageBinary(dcId, Base64.encodeToString(bytes, Base64.NO_WRAP))
            } else {
                WebRTCEventBus.publishDcMessageText(dcId, String(bytes, Charsets.UTF_8))
            }
        }
    }
}
