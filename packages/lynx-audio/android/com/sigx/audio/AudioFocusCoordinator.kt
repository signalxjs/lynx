package com.sigx.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build

/**
 * Reference-counted audio-focus holder — the Android counterpart of iOS's
 * [AudioSessionCoordinator].
 *
 * Focus is requested when the first player or recorder starts and abandoned
 * when the last one stops, and focus changes are republished as interruption
 * events on [AudioEventBus]. Before this, nothing on Android requested focus
 * at all: playback carried on over a phone call, and a recording could be
 * ruined with no signal to the app.
 *
 * Mapping onto the shared JS event, chosen so both platforms mean the same
 * thing by the same word:
 *
 * | Android focus change | JS event |
 * |---|---|
 * | `LOSS`, `LOSS_TRANSIENT`, `LOSS_TRANSIENT_CAN_DUCK` | `began` |
 * | `GAIN` | `ended`, `shouldResume: true` |
 *
 * `CAN_DUCK` is reported as an interruption rather than silently ducking: the
 * app knows whether ducking or pausing is right for its content, and a
 * recording can't duck at all.
 *
 * A permanent `LOSS` is reported as `began` with no matching `ended` — which
 * is accurate. The session is gone and is not coming back on its own, so an
 * app waiting for `ended` should treat a long silence as final.
 */
internal object AudioFocusCoordinator {

    private val lock = Any()
    private var count = 0
    private var manager: AudioManager? = null

    /** API 26+ request handle, kept so the same one can be abandoned. */
    private var request: AudioFocusRequest? = null

    private val listener = AudioManager.OnAudioFocusChangeListener { change ->
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK ->
                AudioEventBus.publishInterruption("began", shouldResume = false)

            AudioManager.AUDIOFOCUS_GAIN ->
                AudioEventBus.publishInterruption("ended", shouldResume = true)
        }
    }

    fun retain(context: Context) {
        synchronized(lock) {
            // Resolve the manager BEFORE touching the count. Incrementing
            // first and bailing on a null service left count > 1 with no
            // manager, so every later retain hit the `count > 1` early return
            // and focus was never requested again for the process lifetime.
            if (count == 0) {
                val am = context.applicationContext
                    .getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
                manager = am
                count = 1
                requestFocus(am)
                return
            }
            count += 1
        }
    }

    fun release() {
        synchronized(lock) {
            if (count == 0) return
            count -= 1
            if (count > 0) return
            val am = manager ?: return
            abandonFocus(am)
            manager = null
        }
    }

    private fun requestFocus(am: AudioManager) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
            val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setOnAudioFocusChangeListener(listener)
                .build()
            request = req
            am.requestAudioFocus(req)
        } else {
            @Suppress("DEPRECATION")
            am.requestAudioFocus(
                listener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN,
            )
        }
    }

    private fun abandonFocus(am: AudioManager) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            request?.let { am.abandonAudioFocusRequest(it) }
            request = null
        } else {
            @Suppress("DEPRECATION")
            am.abandonAudioFocus(listener)
        }
    }
}
