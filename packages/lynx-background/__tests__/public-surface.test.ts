/**
 * Public-surface freeze test for @sigx/lynx-background.
 *
 * Locks the package's exported API so accidental removals or renames break CI
 * rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect (type-only
 *    exports — `RegisterOptions`, `BackgroundTaskType`, `BackgroundHandler`,
 *    `BackgroundFireEvent` — are erased and are pinned by the type layer).
 *  - Types: the load-bearing signatures are pinned, because the shapes are
 *    what `CONVENTIONS.md` constrains — `isAvailable` has to stay synchronous
 *    (C2) and the subscribe-style functions have to keep returning a bare
 *    unsubscribe (C7).
 */
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

// The barrel reaches the native bridge at import time via `background.ts`;
// stubbing it keeps this test about the surface, not about bridge behaviour.
vi.mock('@sigx/lynx-core', async () => ({
    callAsync: vi.fn(async () => undefined as unknown),
    guardModule: vi.fn(),
    isModuleAvailable: vi.fn(() => true),
    // Real, not stubbed — `background.ts` imports these at module scope, and a
    // stub that returned `undefined` would quietly change what the pinned
    // signatures below actually do.
    unwrapNative: (await import('../../lynx-core/src/errors.js')).unwrapNative,
    unwrapNativeVoid: (await import('../../lynx-core/src/errors.js')).unwrapNativeVoid,
}));

import * as background from '../src/index';
import { Background, addBackgroundFireListener } from '../src/index';
import type { BackgroundFireEvent, BackgroundHandler, RegisterOptions } from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(background).sort()).toEqual(
            ['Background', 'addBackgroundFireListener'].sort(),
        );
    });

    it('exposes exactly the documented methods', () => {
        // A new method reaching consumers unannounced is the thing this
        // catches; the README API table has to grow with it. `__resetForTests`
        // lives on `background.ts` and must stay off the barrel.
        expect(Object.keys(Background).sort()).toEqual([
            'getRegistered',
            'isAvailable',
            'register',
            'setHandler',
            'unregister',
        ]);
    });
});

describe('public types', () => {
    it('pins the task-management signatures', () => {
        expectTypeOf(Background.register).toEqualTypeOf<
            (taskName: string, options?: RegisterOptions) => Promise<void>
        >();
        expectTypeOf(Background.unregister).toEqualTypeOf<(taskName: string) => Promise<void>>();
        expectTypeOf(Background.getRegistered).toEqualTypeOf<() => Promise<string[]>>();
    });

    it('keeps isAvailable synchronous and boolean (C2)', () => {
        // The convention most worth freezing: `Biometric.isAvailable()`
        // drifted into returning a Promise, which makes `if (isAvailable())`
        // silently always true.
        expectTypeOf(Background.isAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(Background.isAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });

    it('keeps the subscribe-style functions returning a bare unsubscribe (C7)', () => {
        // Widening these to a disposable object or a Promise would break every
        // `useEffect(() => addBackgroundFireListener(...), [])` at the callsite.
        expectTypeOf(Background.setHandler).toEqualTypeOf<
            (taskName: string, handler: BackgroundHandler) => () => void
        >();
        expectTypeOf(addBackgroundFireListener).toEqualTypeOf<
            (cb: (event: BackgroundFireEvent) => void) => () => void
        >();
    });

    it('pins the wire shape the native side fires', () => {
        // `runId` pairs a fire with its `completeTask` call; dropping it from
        // the type would hide a native/JS protocol break.
        expectTypeOf<BackgroundFireEvent>().toEqualTypeOf<{ taskName: string; runId: string }>();
    });
});
