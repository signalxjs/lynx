package com.sigx.audio

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.lynx.react.bridge.JavaOnlyMap
import java.io.File
import java.util.concurrent.atomic.AtomicLong

/**
 * Owns the `MediaRecorder` instance for active recordings. The plan permits
 * one recorder per process — recording a second clip while one is in flight
 * rejects with an error. We still key the entry by a `Long` id so the JS
 * handle abstraction matches the player side.
 *
 * Metering is opt-in. `setMeterSubscribed(id, true)` posts a 100 ms
 * Handler-loop reading `maxAmplitude` and publishing to [AudioEventBus].
 * The loop self-cancels when the recorder is stopped/released.
 */
internal object AudioRecorderRegistry {

    private const val TAG = "SigxAudioRecorder"
    private const val METER_INTERVAL_MS = 100L

    /// MediaRecorder's `getMaxAmplitude` returns 0..32767 (signed 16-bit
    /// PCM peak between calls). Divide by this to land in the JS linear
    /// 0..1 contract.
    private const val MAX_AMPLITUDE = 32767.0

    private data class Entry(
        val recorder: MediaRecorder,
        val outputPath: String,
        val startedAt: Long,
        var pausedDuration: Long,
        var pausedAt: Long?,
        var meterSubscribed: Boolean,
    )

    private val handler = Handler(Looper.getMainLooper())
    private var entry: Entry? = null
    private var entryId: Long = 0
    private val nextId = AtomicLong(1)

    @Synchronized
    fun start(
        context: Context,
        outputPath: String?,
        format: String,
        sampleRate: Int,
        channels: Int,
    ): JavaOnlyMap {
        if (entry != null) {
            return errorMap("A recording is already in progress")
        }

        // MediaRecorder has no first-class WAV path. The previous attempt
        // here silently substituted AMR_WB-in-3GPP and still named the
        // file `.wav`, which is an API contract lie — consumers reading
        // the returned URI would get a file whose extension and container
        // don't match. Reject the request loudly instead. Apps that
        // genuinely need WAV on Android should record m4a and transcode,
        // or pipe a custom recorder. iOS' `AVAudioRecorder` produces real
        // LinearPCM WAV so the `'wav'` option remains valid there.
        if (format.lowercase() == "wav") {
            return errorMap(
                "Android does not support 'wav' recording — use 'm4a' (AAC) and transcode if WAV is required."
            )
        }
        val path = outputPath ?: File(context.cacheDir, "rec_${System.currentTimeMillis()}.m4a").absolutePath

        // MediaRecorder.Builder lands in API 31; we construct directly so we
        // keep working on the project's min-SDK. Order of setters is fixed
        // by MediaRecorder's state machine — audio source first, then
        // output format, encoder, settings, output file, prepare, start.
        @Suppress("DEPRECATION")
        val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(context)
        } else {
            MediaRecorder()
        }

        try {
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            recorder.setAudioSamplingRate(sampleRate)
            recorder.setAudioChannels(channels.coerceIn(1, 2))
            recorder.setOutputFile(path)
            recorder.prepare()
            recorder.start()
        } catch (e: Exception) {
            try { recorder.release() } catch (_: Throwable) {}
            Log.w(TAG, "start failed: ${e.message}")
            return errorMap("Failed to start recording: ${e.message}")
        }

        val id = nextId.getAndIncrement()
        entry = Entry(
            recorder = recorder,
            outputPath = path,
            startedAt = System.currentTimeMillis(),
            pausedDuration = 0L,
            pausedAt = null,
            meterSubscribed = false,
        )
        entryId = id

        val result = JavaOnlyMap()
        result.putDouble("id", id.toDouble())
        return result
    }

    @Synchronized
    fun pause(id: Long): JavaOnlyMap {
        val e = entry ?: return errorMap("Recorder $id not found")
        if (entryId != id) return errorMap("Recorder $id not found")
        // pause/resume were added in API 24; min-SDK of this project is
        // ≥ 24, so the call is always available.
        try { e.recorder.pause() } catch (e: Exception) {
            return errorMap("Pause failed: ${e.message}")
        }
        e.pausedAt = System.currentTimeMillis()
        return JavaOnlyMap()
    }

    @Synchronized
    fun resume(id: Long): JavaOnlyMap {
        val e = entry ?: return errorMap("Recorder $id not found")
        if (entryId != id) return errorMap("Recorder $id not found")
        e.pausedAt?.let { e.pausedDuration += System.currentTimeMillis() - it }
        e.pausedAt = null
        try { e.recorder.resume() } catch (ex: Exception) {
            return errorMap("Resume failed: ${ex.message}")
        }
        return JavaOnlyMap()
    }

    @Synchronized
    fun stop(id: Long): JavaOnlyMap {
        val e = entry ?: return errorMap("Recorder $id not found")
        if (entryId != id) return errorMap("Recorder $id not found")

        val end = System.currentTimeMillis()
        var elapsed = end - e.startedAt - e.pausedDuration
        e.pausedAt?.let { elapsed -= (end - it) }
        val durationMs = elapsed.coerceAtLeast(0L)

        try { e.recorder.stop() } catch (_: Exception) {}
        try { e.recorder.release() } catch (_: Throwable) {}
        entry = null

        val file = File(e.outputPath)
        val sizeBytes = if (file.exists()) file.length() else 0L

        val result = JavaOnlyMap()
        result.putString("uri", "file://${e.outputPath}")
        result.putInt("durationMs", durationMs.toInt())
        result.putDouble("sizeBytes", sizeBytes.toDouble())
        return result
    }

    @Synchronized
    fun setMeterSubscribed(id: Long, subscribed: Boolean): JavaOnlyMap {
        val e = entry ?: return errorMap("Recorder $id not found")
        if (entryId != id) return errorMap("Recorder $id not found")

        val wasSubscribed = e.meterSubscribed
        e.meterSubscribed = subscribed
        if (subscribed && !wasSubscribed) {
            scheduleMeter(id)
        }
        return JavaOnlyMap()
    }

    private fun scheduleMeter(id: Long) {
        handler.postDelayed({
            val current: Entry?
            synchronized(this) {
                current = if (entryId == id) entry else null
            }
            if (current == null || !current.meterSubscribed) return@postDelayed

            val amplitude = try {
                current.recorder.maxAmplitude
            } catch (_: Exception) {
                0
            }
            // `maxAmplitude` is the peak since last read; we don't get a
            // separate avg from MediaRecorder, so report the same value for
            // both. JS consumers that only need a single envelope value
            // typically use `peak` anyway.
            val linear = (amplitude / MAX_AMPLITUDE).coerceIn(0.0, 1.0)
            AudioEventBus.publishMeter(id, peak = linear, avg = linear)

            scheduleMeter(id)
        }, METER_INTERVAL_MS)
    }

    private fun errorMap(message: String): JavaOnlyMap {
        val map = JavaOnlyMap()
        map.putString("error", message)
        return map
    }
}
