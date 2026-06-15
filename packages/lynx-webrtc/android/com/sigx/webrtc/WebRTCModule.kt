package com.sigx.webrtc

import android.content.Context
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableArray
import com.lynx.react.bridge.ReadableMap
import com.sigx.permissions.PermissionHelper
import org.webrtc.SessionDescription

/**
 * Native WebRTC bridge — JS-callable side.
 *
 * JS usage (via the `@sigx/lynx-webrtc` shim, not directly):
 *
 *   NativeModules.WebRTC.createPeer(id, config, cb)
 *   NativeModules.WebRTC.createOffer(id, options, cb)
 *   NativeModules.WebRTC.getUserMedia(trackId, constraints, cb)
 *   ...
 *
 * State lives in [PeerConnectionStore]. Async events (state changes, ICE
 * candidates, remote tracks, data channel traffic) flow through
 * [WebRTCEventBus] → per-LynxView [WebRTCPublisher] → JS
 * `GlobalEventEmitter`. Microphone permission is delegated to
 * `@sigx/lynx-permissions`' `PermissionHelper` (`"microphone"` →
 * `RECORD_AUDIO`).
 */
class WebRTCModule(context: Context) : LynxModule(context) {

    // MARK: - Media

    // `constraints` is part of the JS-callable signature; v1 ignores it and
    // captures with platform defaults.
    @Suppress("UNUSED_PARAMETER")
    @LynxMethod
    fun getUserMedia(trackId: Int, constraints: ReadableMap?, callback: Callback?) {
        // Browser semantics: prompt whenever the permission is promptable,
        // resolve immediately when granted, fail fast only when blocked.
        when (PermissionHelper.checkPermission(mContext, "microphone").getString("status")) {
            "granted" -> callback?.invoke(captureResult(trackId))
            "blocked" -> callback?.invoke(deniedMap())
            else -> PermissionHelper.requestPermission(mContext, "microphone") { result ->
                if (result.getString("status") == "granted") {
                    callback?.invoke(captureResult(trackId))
                } else {
                    callback?.invoke(deniedMap())
                }
            }
        }
    }

    private fun captureResult(trackId: Int): JavaOnlyMap {
        val error = PeerConnectionStore.createMicrophoneTrack(mContext, trackId)
        if (error != null) return errorMap(error)
        return JavaOnlyMap().apply { putString("label", "microphone") }
    }

    @LynxMethod
    fun setTrackEnabled(trackId: Int, enabled: Boolean, callback: Callback?) {
        callback?.invoke(resultMap(PeerConnectionStore.setTrackEnabled(trackId, enabled)))
    }

    @LynxMethod
    fun stopTrack(trackId: Int, callback: Callback?) {
        callback?.invoke(resultMap(PeerConnectionStore.stopTrack(trackId)))
    }

    // MARK: - Peer connection

    @LynxMethod
    fun createPeer(peerId: Int, config: ReadableMap?, callback: Callback?) {
        callback?.invoke(resultMap(PeerConnectionStore.createPeer(mContext, peerId, config)))
    }

    @LynxMethod
    fun createOffer(peerId: Int, options: ReadableMap?, callback: Callback?) {
        PeerConnectionStore.createOffer(peerId, options) { desc, error ->
            callback?.invoke(descriptionMap(desc, error))
        }
    }

    // `options` keeps signature parity with createOffer; answers take none.
    @Suppress("UNUSED_PARAMETER")
    @LynxMethod
    fun createAnswer(peerId: Int, options: ReadableMap?, callback: Callback?) {
        PeerConnectionStore.createAnswer(peerId) { desc, error ->
            callback?.invoke(descriptionMap(desc, error))
        }
    }

    @LynxMethod
    fun setLocalDescription(peerId: Int, desc: ReadableMap?, callback: Callback?) {
        PeerConnectionStore.setLocalDescription(peerId, desc) { applied, error ->
            callback?.invoke(descriptionMap(applied, error))
        }
    }

    @LynxMethod
    fun setRemoteDescription(peerId: Int, desc: ReadableMap?, callback: Callback?) {
        PeerConnectionStore.setRemoteDescription(peerId, desc) { error ->
            callback?.invoke(resultMap(error))
        }
    }

    @LynxMethod
    fun addIceCandidate(peerId: Int, candidate: ReadableMap?, callback: Callback?) {
        PeerConnectionStore.addIceCandidate(peerId, candidate) { error ->
            callback?.invoke(resultMap(error))
        }
    }

    @LynxMethod
    fun addTrack(peerId: Int, trackId: Int, streamIds: ReadableArray?, callback: Callback?) {
        val ids = mutableListOf<String>()
        if (streamIds != null) {
            for (i in 0 until streamIds.size()) {
                streamIds.getString(i)?.let { if (it.isNotEmpty()) ids.add(it) }
            }
        }
        val (senderId, error) = PeerConnectionStore.addTrack(peerId, trackId, ids)
        if (error != null) {
            callback?.invoke(errorMap(error))
            return
        }
        callback?.invoke(JavaOnlyMap().apply { putInt("senderId", senderId) })
    }

    @LynxMethod
    fun removeTrack(peerId: Int, senderId: Int, callback: Callback?) {
        callback?.invoke(resultMap(PeerConnectionStore.removeTrack(peerId, senderId)))
    }

    @LynxMethod
    fun closePeer(peerId: Int, callback: Callback?) {
        callback?.invoke(resultMap(PeerConnectionStore.closePeer(mContext, peerId)))
    }

    // MARK: - Data channels

    @LynxMethod
    fun createDataChannel(peerId: Int, dcId: Int, label: String?, init: ReadableMap?, callback: Callback?) {
        callback?.invoke(
            resultMap(PeerConnectionStore.createDataChannel(peerId, dcId, label ?: "", init))
        )
    }

    @LynxMethod
    fun dcSend(dcId: Int, payload: String?, isBinary: Boolean, callback: Callback?) {
        callback?.invoke(resultMap(PeerConnectionStore.dcSend(dcId, payload ?: "", isBinary)))
    }

    @LynxMethod
    fun dcClose(dcId: Int, callback: Callback?) {
        callback?.invoke(resultMap(PeerConnectionStore.dcClose(dcId)))
    }

    // MARK: - Audio routing & permission

    @LynxMethod
    fun setAudioOutput(route: String?, callback: Callback?) {
        callback?.invoke(resultMap(WebRTCAudioController.setRoute(mContext, route ?: "")))
    }

    @LynxMethod
    fun requestPermission(callback: Callback?) {
        PermissionHelper.requestPermission(mContext, "microphone") { result ->
            callback?.invoke(result)
        }
    }

    @LynxMethod
    fun getPermissionStatus(callback: Callback?) {
        callback?.invoke(PermissionHelper.checkPermission(mContext, "microphone"))
    }

    // MARK: - Helpers

    private fun resultMap(error: String?): JavaOnlyMap =
        if (error == null) JavaOnlyMap() else errorMap(error)

    private fun descriptionMap(desc: SessionDescription?, error: String?): JavaOnlyMap {
        if (error != null) return errorMap(error)
        return JavaOnlyMap().apply {
            if (desc != null) {
                putString("type", desc.type.canonicalForm())
                putString("sdp", desc.description)
            }
        }
    }

    private fun deniedMap(): JavaOnlyMap = JavaOnlyMap().apply {
        putString("error", "Microphone permission not granted")
        putString("errorName", "NotAllowedError")
    }

    private fun errorMap(message: String): JavaOnlyMap =
        JavaOnlyMap().apply { putString("error", message) }
}
