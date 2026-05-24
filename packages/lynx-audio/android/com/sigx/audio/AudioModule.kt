package com.sigx.audio

import android.content.Context
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.ReadableMap
import com.sigx.permissions.PermissionHelper

/**
 * Audio recording + playback bridge.
 *
 * JS usage (via the `@sigx/lynx-audio` shim, not directly):
 *
 *   NativeModules.Audio.play(uri, opts, cb)
 *   NativeModules.Audio.pausePlayer(id, cb)
 *   NativeModules.Audio.startRecording(opts, cb)
 *   ...
 *
 * State lives in [AudioPlayerRegistry] / [AudioRecorderRegistry]. Async
 * events (`onEnd`, `onMeter`) flow through [AudioEventBus] → per-LynxView
 * [AudioPublisher] → JS `GlobalEventEmitter`. Microphone permission is
 * delegated to `@sigx/lynx-permissions`' `PermissionHelper` (`"microphone"`
 * → `RECORD_AUDIO`).
 */
class AudioModule(context: Context) : LynxModule(context) {

    // MARK: - Playback

    @LynxMethod
    fun play(source: String?, options: ReadableMap?, callback: Callback?) {
        if (source.isNullOrEmpty()) {
            callback?.invoke(errorMap("Missing source"))
            return
        }
        val volume = if (options?.hasKey("volume") == true) options.getDouble("volume") else 1.0
        val loop = if (options?.hasKey("loop") == true) options.getBoolean("loop") else false
        val rate = if (options?.hasKey("rate") == true) options.getDouble("rate") else 1.0
        callback?.invoke(AudioPlayerRegistry.create(mContext, source, volume, loop, rate))
    }

    @LynxMethod
    fun preload(source: String?, callback: Callback?) {
        if (source.isNullOrEmpty()) {
            callback?.invoke(errorMap("Missing source"))
            return
        }
        callback?.invoke(AudioPlayerRegistry.preload(mContext, source))
    }

    @LynxMethod
    fun pausePlayer(id: Double, callback: Callback?) {
        callback?.invoke(AudioPlayerRegistry.pause(id.toLong()))
    }

    @LynxMethod
    fun resumePlayer(id: Double, callback: Callback?) {
        callback?.invoke(AudioPlayerRegistry.resume(id.toLong()))
    }

    @LynxMethod
    fun stopPlayer(id: Double, callback: Callback?) {
        callback?.invoke(AudioPlayerRegistry.stop(id.toLong()))
    }

    @LynxMethod
    fun seekPlayer(id: Double, seconds: Double, callback: Callback?) {
        callback?.invoke(AudioPlayerRegistry.seek(id.toLong(), seconds))
    }

    @LynxMethod
    fun setPlayerVolume(id: Double, volume: Double, callback: Callback?) {
        callback?.invoke(AudioPlayerRegistry.setVolume(id.toLong(), volume))
    }

    @LynxMethod
    fun getPlayerStatus(id: Double, callback: Callback?) {
        callback?.invoke(AudioPlayerRegistry.status(id.toLong()))
    }

    // MARK: - Recording

    @LynxMethod
    fun startRecording(options: ReadableMap?, callback: Callback?) {
        val path = if (options?.hasKey("outputPath") == true) options.getString("outputPath") else null
        val format = if (options?.hasKey("format") == true) options.getString("format") ?: "m4a" else "m4a"
        val sampleRate = if (options?.hasKey("sampleRate") == true) options.getDouble("sampleRate").toInt() else 44100
        val channels = if (options?.hasKey("channels") == true) options.getDouble("channels").toInt() else 1

        // MediaRecorder requires RECORD_AUDIO to be granted before `start()`
        // — surface a clear error rather than letting the call throw deep
        // inside MediaRecorder's state machine.
        val status = PermissionHelper.checkPermission(mContext, "microphone")
        if (status.getString("status") != "granted") {
            callback?.invoke(errorMap("Microphone permission not granted"))
            return
        }

        callback?.invoke(AudioRecorderRegistry.start(mContext, path, format, sampleRate, channels))
    }

    @LynxMethod
    fun pauseRecording(id: Double, callback: Callback?) {
        callback?.invoke(AudioRecorderRegistry.pause(id.toLong()))
    }

    @LynxMethod
    fun resumeRecording(id: Double, callback: Callback?) {
        callback?.invoke(AudioRecorderRegistry.resume(id.toLong()))
    }

    @LynxMethod
    fun stopRecording(id: Double, callback: Callback?) {
        callback?.invoke(AudioRecorderRegistry.stop(id.toLong()))
    }

    @LynxMethod
    fun setMeterSubscribed(id: Double, subscribed: Boolean, callback: Callback?) {
        callback?.invoke(AudioRecorderRegistry.setMeterSubscribed(id.toLong(), subscribed))
    }

    // MARK: - Permission

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

    private fun errorMap(message: String): com.lynx.react.bridge.JavaOnlyMap {
        val map = com.lynx.react.bridge.JavaOnlyMap()
        map.putString("error", message)
        return map
    }
}
