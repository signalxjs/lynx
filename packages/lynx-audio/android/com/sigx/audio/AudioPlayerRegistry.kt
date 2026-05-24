package com.sigx.audio

import android.content.Context
import android.media.MediaPlayer
import android.net.Uri
import android.util.Log
import com.lynx.react.bridge.JavaOnlyMap
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * Owns the `MediaPlayer` instances created by `Audio.play()`. Each entry is
 * keyed by a `Long` id; JS holds the id and re-passes it for every method
 * call on the handle. Multiple players coexist for concurrent playback
 * (background music + UI sound effects).
 *
 * Lifecycle: `play()` allocates + `prepare`s synchronously; `stop()` or
 * natural end-of-clip releases the `MediaPlayer` and removes the entry.
 */
internal object AudioPlayerRegistry {

    private const val TAG = "SigxAudioPlayer"

    private val players = ConcurrentHashMap<Long, MediaPlayer>()
    private val nextId = AtomicLong(1)

    fun create(
        context: Context,
        source: String,
        volume: Double,
        loop: Boolean,
        rate: Double,
    ): JavaOnlyMap {
        val mp = MediaPlayer()
        try {
            // setDataSource accepts file URIs, content URIs, and HTTP(S)
            // URLs uniformly when passed via the Context+Uri overload.
            val uri = resolveUri(source)
            mp.setDataSource(context, uri)
            mp.prepare()
            val vol = volume.coerceIn(0.0, 1.0).toFloat()
            mp.setVolume(vol, vol)
            mp.isLooping = loop
            if (rate != 1.0) {
                // PlaybackParams was added in API 23; we target ≥ 23 across
                // the project so this is always available.
                mp.playbackParams = mp.playbackParams.setSpeed(rate.toFloat())
            }
        } catch (e: Exception) {
            mp.release()
            Log.w(TAG, "create failed: ${e.message}")
            return errorMap("Failed to load audio: ${e.message}")
        }

        val id = nextId.getAndIncrement()
        players[id] = mp

        mp.setOnCompletionListener {
            // Looping players don't fire onCompletion; reaching here means
            // the clip really ended. JS handle is dead — release + publish.
            release(id)
            AudioEventBus.publishPlayerEnd(id)
        }

        try {
            mp.start()
        } catch (e: Exception) {
            release(id)
            return errorMap("Failed to start playback: ${e.message}")
        }

        val result = JavaOnlyMap()
        result.putDouble("id", id.toDouble())
        result.putInt("durationMs", mp.duration.coerceAtLeast(0))
        return result
    }

    fun pause(id: Long): JavaOnlyMap {
        val mp = players[id] ?: return errorMap("Player $id not found")
        try { mp.pause() } catch (_: IllegalStateException) {}
        return JavaOnlyMap()
    }

    fun resume(id: Long): JavaOnlyMap {
        val mp = players[id] ?: return errorMap("Player $id not found")
        try { mp.start() } catch (e: IllegalStateException) {
            return errorMap("Resume failed: ${e.message}")
        }
        return JavaOnlyMap()
    }

    fun stop(id: Long): JavaOnlyMap {
        val mp = players[id] ?: return errorMap("Player $id not found")
        try { mp.stop() } catch (_: IllegalStateException) {}
        release(id)
        return JavaOnlyMap()
    }

    fun seek(id: Long, seconds: Double): JavaOnlyMap {
        val mp = players[id] ?: return errorMap("Player $id not found")
        val target = (seconds * 1000.0).toInt().coerceIn(0, mp.duration.coerceAtLeast(0))
        try { mp.seekTo(target) } catch (e: IllegalStateException) {
            return errorMap("Seek failed: ${e.message}")
        }
        return JavaOnlyMap()
    }

    fun setVolume(id: Long, volume: Double): JavaOnlyMap {
        val mp = players[id] ?: return errorMap("Player $id not found")
        val v = volume.coerceIn(0.0, 1.0).toFloat()
        mp.setVolume(v, v)
        return JavaOnlyMap()
    }

    fun status(id: Long): JavaOnlyMap {
        val map = JavaOnlyMap()
        val mp = players[id]
        if (mp == null) {
            map.putInt("positionMs", 0)
            map.putInt("durationMs", 0)
            map.putBoolean("playing", false)
            return map
        }
        map.putInt("positionMs", mp.currentPosition.coerceAtLeast(0))
        map.putInt("durationMs", mp.duration.coerceAtLeast(0))
        map.putBoolean("playing", mp.isPlaying)
        return map
    }

    /**
     * Synchronous decode → duration. Used by `Audio.preload`. The player is
     * created, prepared, and immediately released; nothing is registered.
     */
    fun preload(context: Context, source: String): JavaOnlyMap {
        val mp = MediaPlayer()
        return try {
            mp.setDataSource(context, resolveUri(source))
            mp.prepare()
            val duration = mp.duration.coerceAtLeast(0)
            mp.release()
            val map = JavaOnlyMap()
            map.putInt("durationMs", duration)
            map
        } catch (e: Exception) {
            mp.release()
            errorMap("Failed to load audio: ${e.message}")
        }
    }

    private fun release(id: Long) {
        val mp = players.remove(id) ?: return
        try { mp.release() } catch (_: Throwable) {}
    }

    private fun resolveUri(source: String): Uri {
        return when {
            source.startsWith("/") -> Uri.fromFile(java.io.File(source))
            else -> Uri.parse(source)
        }
    }

    private fun errorMap(message: String): JavaOnlyMap {
        val map = JavaOnlyMap()
        map.putString("error", message)
        return map
    }
}
