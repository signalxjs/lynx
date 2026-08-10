/**
 * Public-surface freeze test for @sigx/lynx-camera.
 *
 * Locks the package's exported API so accidental removals or renames break CI
 * rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. The barrel
 *    also re-exports types (`CameraOptions`, `PhotoResult`, `PermissionResponse`,
 *    …), which are erased and so never appear here.
 *  - Types: the load-bearing signatures are pinned, because those shapes are
 *    what `CONVENTIONS.md` constrains — the capture result union (C5), the
 *    permission pair (C6) and a synchronous `isAvailable` (C2).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as camera from '../src/index.js';
import { Camera } from '../src/index.js';
import type { CameraCancelled, CameraOptions, CameraVideoOptions, PhotoResult, VideoResult } from '../src/index.js';
import type { PermissionResponse } from '@sigx/lynx-core';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(camera).sort()).toEqual(['Camera']);
    });

    it('exposes exactly the documented methods', () => {
        // A new method reaching consumers unannounced is the thing this
        // catches; the README API table has to grow with it.
        expect(Object.keys(Camera).sort()).toEqual(
            ['getPermissionStatus', 'isAvailable', 'recordVideo', 'requestPermission', 'takePicture'].sort(),
        );
    });
});

describe('public types', () => {
    it('pins the capture signatures and their cancel union (C5)', () => {
        // Callers narrow on `result.uri`; collapsing the union to a bare
        // `PhotoResult` would make every cancel look like a successful
        // capture, and widening it would break existing narrowing.
        expectTypeOf(Camera.takePicture).toEqualTypeOf<
            (options?: CameraOptions) => Promise<PhotoResult | CameraCancelled>
        >();
        expectTypeOf(Camera.recordVideo).toEqualTypeOf<
            (options?: CameraVideoOptions) => Promise<VideoResult | CameraCancelled>
        >();
        expectTypeOf<CameraCancelled>().toEqualTypeOf<{ cancelled: true; uri?: undefined }>();
    });

    it('keeps the permission pair on PermissionResponse (C6)', () => {
        expectTypeOf(Camera.requestPermission).toEqualTypeOf<() => Promise<PermissionResponse>>();
        expectTypeOf(Camera.getPermissionStatus).toEqualTypeOf<() => Promise<PermissionResponse>>();
    });

    it('keeps isAvailable synchronous and boolean (C2)', () => {
        // The convention most worth freezing: `Biometric.isAvailable()` drifted
        // into returning a Promise, which makes `if (mod.isAvailable())`
        // silently always true.
        expectTypeOf(Camera.isAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(Camera.isAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });
});
