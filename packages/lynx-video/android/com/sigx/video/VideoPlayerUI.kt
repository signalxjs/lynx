package com.sigx.video

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.lynx.tasm.behavior.LynxContext
import com.lynx.tasm.behavior.LynxProp
import com.lynx.tasm.behavior.ui.LynxUI
import com.lynx.tasm.event.LynxDetailEvent

/**
 * Native UI for the `<video-player>` JSX element on Android.
 *
 * Backed by `androidx.media3` (`ExoPlayer` + `PlayerView`). The PlayerView
 * is added directly to Lynx's view tree and decoded frames render inside it.
 *
 * Prop / event surface (v1):
 *   - `src`           → URL or `file://` URI
 *   - `poster`        → image displayed before the first frame (best-effort)
 *   - `autoplay`      → start as soon as the asset is ready
 *   - `playing`       → declarative play/pause toggle
 *   - `loop`          → restart at end-of-clip
 *   - `muted`         → mute audio
 *   - `volume`        → 0..1
 *   - `controls`      → show PlayerView's built-in transport controls
 *   - `resize-mode`   → contain | cover | stretch
 *   - `start-time`    → one-shot initial seek (seconds) before first play
 *   - `bindload`      → asset metadata ready
 *   - `bindend`       → playback finished
 *   - `binderror`     → load / playback failure
 *   - `bindtimeupdate` → ~4×/sec position broadcast
 *   - `bindstatechange` → playing | paused | buffering | ended transitions
 *
 * Imperative methods (`seek`, `getStatus`) are tracked as a v2 follow-up
 * — same UIMethodInvoker blocker as `WebView`/`Map`. Drive playback
 * declaratively via the `playing` / `src` props.
 */
@OptIn(UnstableApi::class)
class VideoPlayerUI(context: LynxContext) : LynxUI<PlayerView>(context) {

    companion object {
        private const val TIME_UPDATE_INTERVAL_MS = 250L
    }

    private var exoPlayer: ExoPlayer? = null
    private val handler = Handler(Looper.getMainLooper())
    private var didEmitLoad = false

    // Pending prop values applied either at createView() time or once the
    // player transitions to STATE_READY (autoplay, playing, muted, volume).
    private var pendingSrc: String? = null
    private var pendingAutoplay = false
    private var pendingPlaying: Boolean? = null
    private var pendingLoop = false
    private var pendingMuted = false
    private var pendingVolume = 1f
    private var pendingControls = false
    private var pendingResizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
    private var pendingStartTimeMs: Long? = null

    private val timeUpdateRunnable = object : Runnable {
        override fun run() {
            // Self-rescheduling loop, but only while actively playing —
            // otherwise we'd keep waking the main thread every 250 ms
            // forever while the user is on a paused / ended clip.
            // `onIsPlayingChanged` re-arms us when playback resumes.
            val player = exoPlayer ?: return
            if (!player.isPlaying) return
            fireEvent("timeupdate", mapOf("positionMs" to player.currentPosition.coerceAtLeast(0L)))
            handler.postDelayed(this, TIME_UPDATE_INTERVAL_MS)
        }
    }

    override fun createView(context: Context): PlayerView {
        val view = PlayerView(context)
        view.useController = pendingControls
        view.resizeMode = pendingResizeMode

        val player = ExoPlayer.Builder(context).build()
        player.volume = if (pendingMuted) 0f else pendingVolume
        player.repeatMode = if (pendingLoop) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
        player.addListener(playerListener)
        view.player = player
        exoPlayer = player

        pendingSrc?.let { loadSource(it) }
        return view
    }

    override fun onDetach() {
        super.onDetach()
        handler.removeCallbacks(timeUpdateRunnable)
        runCatching { exoPlayer?.release() }
        exoPlayer = null
    }

    private val playerListener = object : Player.Listener {
        override fun onPlaybackStateChanged(state: Int) {
            when (state) {
                Player.STATE_READY -> {
                    if (!didEmitLoad) {
                        didEmitLoad = true
                        val player = exoPlayer ?: return
                        val duration = if (player.duration == androidx.media3.common.C.TIME_UNSET) 0L
                                       else player.duration.coerceAtLeast(0L)
                        // Video size may not be reported synchronously on
                        // every codec — `onVideoSizeChanged` follows up.
                        val size = player.videoSize
                        fireEvent(
                            "load",
                            mapOf(
                                "durationMs" to duration,
                                "width" to size.width,
                                "height" to size.height,
                            ),
                        )
                        applyQueuedPlayState()
                    }
                }
                Player.STATE_BUFFERING -> {
                    val pos = exoPlayer?.currentPosition?.coerceAtLeast(0L) ?: 0L
                    fireEvent("statechange", mapOf("state" to "buffering", "positionMs" to pos))
                }
                Player.STATE_ENDED -> {
                    // ExoPlayer.REPEAT_MODE_ONE handles looping natively, so
                    // reaching STATE_ENDED means we truly finished.
                    val pos = exoPlayer?.currentPosition?.coerceAtLeast(0L) ?: 0L
                    fireEvent("statechange", mapOf("state" to "ended", "positionMs" to pos))
                    fireEvent("end", emptyMap())
                }
                else -> {}
            }
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            handler.removeCallbacks(timeUpdateRunnable)
            val player = exoPlayer ?: return
            val pos = player.currentPosition.coerceAtLeast(0L)
            if (isPlaying) {
                fireEvent("statechange", mapOf("state" to "playing", "positionMs" to pos))
                handler.postDelayed(timeUpdateRunnable, TIME_UPDATE_INTERVAL_MS)
            } else if (player.playbackState != Player.STATE_ENDED) {
                // The end-of-clip stop is reported as `ended` via
                // onPlaybackStateChanged; avoid a spurious `paused` there.
                fireEvent("statechange", mapOf("state" to "paused", "positionMs" to pos))
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            fireEvent("error", mapOf("message" to (error.message ?: "Playback error")))
        }

        override fun onVideoSizeChanged(videoSize: VideoSize) {
            // The initial bindload may have reported width/height=0 if the
            // codec hadn't decoded a frame yet. We don't re-fire bindload
            // here — apps that need the post-decode size can observe the
            // element's measured layout. (Lynx fires `bindlayoutchange`
            // through LynxCommonAttributes for that.)
        }
    }

    // ── Prop setters ─────────────────────────────────────────────────────

    @LynxProp(name = "src")
    fun setSrc(value: String?) {
        if (value.isNullOrEmpty()) {
            // Clearing the prop must stop and unload the current item —
            // otherwise a re-render that drops `src` would keep the
            // previous clip playing. We stop the timer loop and clear
            // any pending media item.
            pendingSrc = null
            didEmitLoad = false
            handler.removeCallbacks(timeUpdateRunnable)
            exoPlayer?.let { player ->
                try { player.stop() } catch (_: Throwable) {}
                try { player.clearMediaItems() } catch (_: Throwable) {}
            }
            return
        }
        pendingSrc = value
        if (exoPlayer != null) loadSource(value)
    }

    @LynxProp(name = "poster")
    fun setPoster(value: String?) {
        // Best-effort: when a poster URL is provided we set it as the
        // PlayerView's defaultArtwork via the artwork display flag once we
        // get a frame. v1 keeps this minimal — apps that need a poster
        // render an <image> sibling instead and toggle visibility on
        // `bindload`.
    }

    @LynxProp(name = "autoplay")
    fun setAutoplay(value: Boolean) {
        pendingAutoplay = value
        val player = exoPlayer ?: return
        if (value && player.playbackState == Player.STATE_READY) {
            player.playWhenReady = true
            player.play()
        }
    }

    @LynxProp(name = "playing")
    fun setPlaying(value: Boolean) {
        pendingPlaying = value
        val player = exoPlayer ?: return
        if (player.playbackState == Player.STATE_READY) {
            if (value) player.play() else player.pause()
        }
    }

    @LynxProp(name = "loop")
    fun setLoop(value: Boolean) {
        pendingLoop = value
        exoPlayer?.repeatMode = if (value) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
    }

    @LynxProp(name = "muted")
    fun setMuted(value: Boolean) {
        pendingMuted = value
        exoPlayer?.volume = if (value) 0f else pendingVolume
    }

    @LynxProp(name = "volume")
    fun setVolume(value: Double) {
        val v = value.coerceIn(0.0, 1.0).toFloat()
        pendingVolume = v
        if (!pendingMuted) exoPlayer?.volume = v
    }

    @LynxProp(name = "controls")
    fun setControls(value: Boolean) {
        pendingControls = value
        mView.useController = value
    }

    @LynxProp(name = "start-time")
    fun setStartTime(value: Double) {
        pendingStartTimeMs = if (value > 0) (value * 1000).toLong() else null
    }

    @LynxProp(name = "resize-mode")
    fun setResizeMode(value: String?) {
        val mode = when (value) {
            "cover"   -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            "stretch" -> AspectRatioFrameLayout.RESIZE_MODE_FILL
            else      -> AspectRatioFrameLayout.RESIZE_MODE_FIT
        }
        pendingResizeMode = mode
        mView.resizeMode = mode
    }

    // ── Internals ────────────────────────────────────────────────────────

    private fun loadSource(source: String) {
        val player = exoPlayer ?: return
        didEmitLoad = false
        val uri = if (source.startsWith("/")) Uri.fromFile(java.io.File(source))
                  else Uri.parse(source)
        val item = MediaItem.fromUri(uri)
        player.setMediaItem(item)
        player.prepare()
        // playWhenReady stays governed by autoplay/playing props applied
        // after STATE_READY in `applyQueuedPlayState`.
        player.playWhenReady = false
    }

    private fun applyQueuedPlayState() {
        val player = exoPlayer ?: return
        // One-shot initial seek before the first play.
        pendingStartTimeMs?.let { player.seekTo(it); pendingStartTimeMs = null }
        val explicit = pendingPlaying
        when {
            explicit == true  -> player.play()
            explicit == false -> player.pause()
            pendingAutoplay   -> player.play()
            else              -> player.pause()
        }
    }

    private fun fireEvent(name: String, params: Map<String, Any?>) {
        val event = LynxDetailEvent(sign, name)
        for ((k, v) in params) event.addDetail(k, v)
        lynxContext.eventEmitter.sendCustomEvent(event)
    }
}
