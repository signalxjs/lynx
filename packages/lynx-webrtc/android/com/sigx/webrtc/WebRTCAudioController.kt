package com.sigx.webrtc

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.util.Log

/**
 * Call-audio session management, ref-counted across live peer
 * connections: the first peer switches the [AudioManager] into
 * `MODE_IN_COMMUNICATION` and routes output to the loudspeaker (the
 * default for a hands-free call UI); the last peer to close restores
 * whatever state the app was in before.
 */
internal object WebRTCAudioController {

    private const val TAG = "SigxWebRTCAudio"

    private var livePeers = 0
    private var savedMode = AudioManager.MODE_NORMAL
    private var savedSpeakerphone = false
    private var route: String = "speaker"

    @Synchronized
    fun retain(context: Context) {
        livePeers++
        if (livePeers > 1) return
        val am = audioManager(context) ?: return
        savedMode = am.mode
        @Suppress("DEPRECATION")
        savedSpeakerphone = am.isSpeakerphoneOn
        am.mode = AudioManager.MODE_IN_COMMUNICATION
        applyRouteLocked(am)
    }

    @Synchronized
    fun release(context: Context) {
        if (livePeers == 0) return
        livePeers--
        if (livePeers > 0) return
        val am = audioManager(context) ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            am.clearCommunicationDevice()
        }
        @Suppress("DEPRECATION")
        am.isSpeakerphoneOn = savedSpeakerphone
        am.mode = savedMode
        route = "speaker"
    }

    /** Route call audio to `"speaker"` or `"earpiece"`. Persists across retain/release cycles of the same call. */
    @Synchronized
    fun setRoute(context: Context, newRoute: String): String? {
        if (newRoute != "speaker" && newRoute != "earpiece") {
            return "Unknown audio route \"$newRoute\""
        }
        route = newRoute
        if (livePeers == 0) return null // applied when the next call starts
        val am = audioManager(context) ?: return "AudioManager unavailable"
        applyRouteLocked(am)
        return null
    }

    private fun applyRouteLocked(am: AudioManager) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val wanted = if (route == "speaker") {
                AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
            } else {
                AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
            }
            val device = am.availableCommunicationDevices.firstOrNull { it.type == wanted }
            if (device != null) {
                if (!am.setCommunicationDevice(device)) {
                    Log.w(TAG, "setCommunicationDevice(${device.type}) refused; falling back to speakerphone flag")
                    @Suppress("DEPRECATION")
                    am.isSpeakerphoneOn = route == "speaker"
                }
                return
            }
            // Devices without an earpiece (tablets) — fall through.
        }
        @Suppress("DEPRECATION")
        am.isSpeakerphoneOn = route == "speaker"
    }

    private fun audioManager(context: Context): AudioManager? =
        context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
}
