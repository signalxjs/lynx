import { component, type Define } from '@sigx/lynx';
import './jsx-augment.js';
import type {
    VideoEndEvent,
    VideoErrorEvent,
    VideoLoadEvent,
    VideoResizeMode,
    VideoTimeUpdateEvent,
} from './jsx-augment.js';

export type VideoPlayerProps =
    & Define.Prop<'src', string, false>
    & Define.Prop<'poster', string, false>
    & Define.Prop<'autoplay', boolean, false>
    & Define.Prop<'playing', boolean, false>
    & Define.Prop<'loop', boolean, false>
    & Define.Prop<'muted', boolean, false>
    & Define.Prop<'volume', number, false>
    & Define.Prop<'controls', boolean, false>
    & Define.Prop<'resizeMode', VideoResizeMode, false>
    & Define.Prop<'class', string, false>
    & Define.Prop<'style', string | Record<string, string | number>, false>
    & Define.Prop<'onLoad', (e: VideoLoadEvent) => void, false>
    & Define.Prop<'onEnd', (e: VideoEndEvent) => void, false>
    & Define.Prop<'onError', (e: VideoErrorEvent) => void, false>
    & Define.Prop<'onTimeUpdate', (e: VideoTimeUpdateEvent) => void, false>;

/**
 * Native video player.
 *
 * On iOS this wraps an `AVPlayer` inside an `AVPlayerLayer`; on Android,
 * `androidx.media3.exoplayer.ExoPlayer` inside a `PlayerView`. The element
 * participates in Lynx's layout tree like any other view — give it a
 * `width` / `height` (or `aspectRatio`) and it draws decoded frames there.
 *
 * @example
 * ```tsx
 * <VideoPlayer
 *   src="https://example.com/clip.mp4"
 *   autoplay
 *   controls
 *   onLoad={(e) => console.log('dur', e.detail.durationMs)}
 *   onEnd={() => console.log('done')}
 *   style={{ width: '100%', aspectRatio: 16 / 9 }}
 * />
 * ```
 *
 * @remarks
 * Imperative methods (`seek`, `getStatus`) are not yet implemented — see the
 * package README. v1 is declarative-only via the `playing` / `src` props.
 */
export const VideoPlayer = component<VideoPlayerProps>(({ props }) => {
    return () => (
        <video-player
            src={props.src}
            poster={props.poster}
            autoplay={props.autoplay}
            playing={props.playing}
            loop={props.loop}
            muted={props.muted}
            volume={props.volume}
            controls={props.controls}
            resize-mode={props.resizeMode}
            class={props.class}
            style={props.style}
            bindload={props.onLoad}
            bindend={props.onEnd}
            binderror={props.onError}
            bindtimeupdate={props.onTimeUpdate}
        />
    );
});
