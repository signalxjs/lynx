/**
 * Public-surface freeze test for @sigx/lynx-audio.
 *
 * Locks the exported API so accidental removals or renames break CI rather
 * than reaching consumers. Update the snapshot and the type pins together when
 * the surface changes on purpose.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`. The
 * handle shapes matter as much as the namespace here: `AudioHandle` and
 * `RecordingHandle` are what callers actually hold, and their subscription
 * methods have a C7 contract (return `() => void`, not `{ remove() }`).
 */
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import * as audio from '../src/index';
import { Audio } from '../src/index';
import type { AudioHandle, MeterSample, PlayerStatus, RecordingHandle, RecordingResult } from '../src/index';
import { makeAudioHandle, makeRecordingHandle } from '../src/handles';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        // Types are erased at runtime, so `Audio` is the only value export.
        expect(Object.keys(audio).sort()).toEqual(['Audio']);
    });

    it('exposes exactly the documented methods', () => {
        expect(Object.keys(Audio).sort()).toEqual([
            'getPermissionStatus',
            'isAvailable',
            'play',
            'preload',
            'requestPermission',
            'startRecording',
        ]);
    });

    it('pins the handle surfaces', () => {
        vi.stubGlobal('NativeModules', { Audio: {} });
        expect(Object.keys(makeAudioHandle(1)).sort()).toEqual([
            'getStatus',
            'id',
            'onEnd',
            'pause',
            'resume',
            'seek',
            'setVolume',
            'stop',
        ]);
        expect(Object.keys(makeRecordingHandle(1)).sort()).toEqual([
            'id',
            'onMeter',
            'pause',
            'resume',
            'stop',
        ]);
        vi.unstubAllGlobals();
    });
});

describe('public types', () => {
    it('keeps isAvailable synchronous and boolean (C2)', () => {
        expectTypeOf(Audio.isAvailable).toEqualTypeOf<() => boolean>();
    });

    it('pins the permission pair to core\'s PermissionResponse (C6)', () => {
        expectTypeOf(Audio.requestPermission).returns.toEqualTypeOf<Promise<audio.PermissionResponse>>();
        expectTypeOf(Audio.getPermissionStatus).returns.toEqualTypeOf<Promise<audio.PermissionResponse>>();
    });

    it('keeps subscriptions returning an unsubscribe function (C7)', () => {
        // The convention that `{ remove() }` violates — and that the metering
        // reference-count fix depends on, since the disposer must be callable
        // more than once.
        expectTypeOf<AudioHandle['onEnd']>().toEqualTypeOf<(cb: () => void) => () => void>();
        expectTypeOf<RecordingHandle['onMeter']>().toEqualTypeOf<
            (cb: (m: MeterSample) => void) => () => void
        >();
    });

    it('pins the result shapes callers destructure', () => {
        expectTypeOf<PlayerStatus>().toEqualTypeOf<{
            positionMs: number;
            durationMs: number;
            playing: boolean;
        }>();
        expectTypeOf<RecordingResult>().toEqualTypeOf<{
            uri: string;
            durationMs: number;
            sizeBytes: number;
        }>();
        expectTypeOf<MeterSample>().toEqualTypeOf<{ peak: number; avg: number }>();
    });
});
