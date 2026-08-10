/**
 * Public-surface freeze test for @sigx/lynx-video.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-clipboard/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. This
 *    package is component-only — `VideoPlayerProps`, the JSX attribute
 *    interface and every event type are type-only and erased at runtime, so
 *    they are pinned below instead.
 *  - Types: the load-bearing shapes. There is no native module namespace
 *    here, so `CONVENTIONS.md`'s `isAvailable` (C2), permission (C6) and
 *    subscription (C7) contracts don't apply; the weight goes on the prop and
 *    event shapes, which are what a consumer's `<VideoPlayer>` call site is
 *    written against and what the native AVPlayer / ExoPlayer setters parse.
 *
 * Note: this package has no `.web.ts` sibling — `<video-player>` is a
 * native-only element — so there is no web-parity block (D7.1b) to assert.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as video from '../src/index';
import type {
    VideoEndEvent,
    VideoErrorEvent,
    VideoLoadEvent,
    VideoPlaybackState,
    VideoPlayerAttributes,
    VideoPlayerProps,
    VideoResizeMode,
    VideoStateChangeEvent,
    VideoTimeUpdateEvent,
} from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(video).sort()).toEqual(['VideoPlayer']);
    });
});

describe('public types', () => {
    it('pins the <VideoPlayer> prop surface', () => {
        // Every prop is optional by design: a `<VideoPlayer>` with no props
        // renders an empty player box. Making `src` required would be a
        // breaking change no runtime snapshot can catch.
        expectTypeOf<VideoPlayerProps['src']>().toEqualTypeOf<string | undefined>();
        expectTypeOf<VideoPlayerProps['poster']>().toEqualTypeOf<string | undefined>();
        expectTypeOf<VideoPlayerProps['autoplay']>().toEqualTypeOf<boolean | undefined>();
        expectTypeOf<VideoPlayerProps['playing']>().toEqualTypeOf<boolean | undefined>();
        expectTypeOf<VideoPlayerProps['loop']>().toEqualTypeOf<boolean | undefined>();
        expectTypeOf<VideoPlayerProps['muted']>().toEqualTypeOf<boolean | undefined>();
        expectTypeOf<VideoPlayerProps['volume']>().toEqualTypeOf<number | undefined>();
        expectTypeOf<VideoPlayerProps['controls']>().toEqualTypeOf<boolean | undefined>();
    });

    it('keeps the camelCase props that map onto kebab-case attributes', () => {
        // These two are the only props whose JS name differs from the wire
        // attribute the native setters bind to. Renaming either side without
        // the other typechecks fine and silently stops resizing / seeking.
        expectTypeOf<VideoPlayerProps['resizeMode']>().toEqualTypeOf<VideoResizeMode | undefined>();
        expectTypeOf<VideoPlayerProps['startTime']>().toEqualTypeOf<number | undefined>();
        expectTypeOf<VideoPlayerAttributes['resize-mode']>().toEqualTypeOf<VideoResizeMode | undefined>();
        expectTypeOf<VideoPlayerAttributes['start-time']>().toEqualTypeOf<number | undefined>();
    });

    it('pins the string unions native switches on', () => {
        // Both cross the bridge as bare strings and are matched literally by
        // the iOS/Android implementations, so adding or renaming a member is
        // a cross-language change, not a local refactor.
        expectTypeOf<VideoResizeMode>().toEqualTypeOf<'contain' | 'cover' | 'stretch'>();
        expectTypeOf<VideoPlaybackState>().toEqualTypeOf<'playing' | 'paused' | 'buffering' | 'ended'>();
    });

    it('pins the event handler props and their discriminants', () => {
        // Handlers are written inline at the call site against `e.detail`, so
        // the detail shape *is* the public API. The `type` literals stay
        // narrowed so a union of video events can still be discriminated.
        expectTypeOf<VideoPlayerProps['onLoad']>().toEqualTypeOf<
            ((e: VideoLoadEvent) => void) | undefined
        >();
        expectTypeOf<VideoPlayerProps['onEnd']>().toEqualTypeOf<((e: VideoEndEvent) => void) | undefined>();
        expectTypeOf<VideoPlayerProps['onError']>().toEqualTypeOf<
            ((e: VideoErrorEvent) => void) | undefined
        >();
        expectTypeOf<VideoPlayerProps['onTimeUpdate']>().toEqualTypeOf<
            ((e: VideoTimeUpdateEvent) => void) | undefined
        >();
        expectTypeOf<VideoPlayerProps['onStateChange']>().toEqualTypeOf<
            ((e: VideoStateChangeEvent) => void) | undefined
        >();
        expectTypeOf<VideoLoadEvent['type']>().toEqualTypeOf<'load'>();
        expectTypeOf<VideoEndEvent['type']>().toEqualTypeOf<'end'>();
        expectTypeOf<VideoErrorEvent['type']>().toEqualTypeOf<'error'>();
        expectTypeOf<VideoTimeUpdateEvent['type']>().toEqualTypeOf<'timeupdate'>();
        expectTypeOf<VideoStateChangeEvent['type']>().toEqualTypeOf<'videostatechange'>();
    });

    it('pins the event detail fields the native side emits', () => {
        // Milliseconds, not seconds, on every position/duration field — the
        // unit is only expressed in the name, so a native change to seconds
        // would be a silent 1000× error in every consumer's progress UI.
        expectTypeOf<VideoLoadEvent['detail']['durationMs']>().toEqualTypeOf<number>();
        expectTypeOf<VideoLoadEvent['detail']['width']>().toEqualTypeOf<number>();
        expectTypeOf<VideoLoadEvent['detail']['height']>().toEqualTypeOf<number>();
        expectTypeOf<VideoTimeUpdateEvent['detail']['positionMs']>().toEqualTypeOf<number>();
        expectTypeOf<VideoStateChangeEvent['detail']['state']>().toEqualTypeOf<VideoPlaybackState>();
        expectTypeOf<VideoStateChangeEvent['detail']['positionMs']>().toEqualTypeOf<number>();
        expectTypeOf<VideoErrorEvent['detail']['message']>().toEqualTypeOf<string>();
    });

    it('pins the JSX handler shape on the intrinsic element', () => {
        // `<video-player>` is usable directly, not only through the wrapper
        // component, so its `bind*` names are public surface too — the native
        // element emits on exactly these.
        expectTypeOf<VideoPlayerAttributes['bindload']>().toEqualTypeOf<
            ((e: VideoLoadEvent) => void) | undefined
        >();
        expectTypeOf<VideoPlayerAttributes['bindvideostatechange']>().toEqualTypeOf<
            ((e: VideoStateChangeEvent) => void) | undefined
        >();
        expectTypeOf<VideoPlayerAttributes['bindtimeupdate']>().toEqualTypeOf<
            ((e: VideoTimeUpdateEvent) => void) | undefined
        >();
    });
});
