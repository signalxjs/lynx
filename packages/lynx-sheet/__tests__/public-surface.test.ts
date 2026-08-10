/**
 * Public-surface freeze test for @sigx/lynx-sheet.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. Type-only
 *    exports (`DetentSpec`, `SheetEngine`, `BottomSheetProps`, …) are erased
 *    at runtime and are pinned below instead.
 *  - Types: the load-bearing signatures. This package has no native module —
 *    no `isAvailable` (C2), no permissions (C6), no subscriptions (C7) — so
 *    the contracts worth freezing are the ones consumers and *worklets* bind
 *    to: the pure math is worklet-safe (numbers in, numbers out, no unions or
 *    objects that would need a deep worklet copy), and the engine hands back
 *    SharedValues/MainThreadRefs whose MT-ownership the whole drag pipeline
 *    assumes (C8).
 *
 * Note: this package has no `.web.ts` sibling — it is pure JS driving the
 * shared gesture/motion layer — so there is no web-parity block (D7.1b).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as sheet from '../src/index';
import type {
    DetentEnv,
    DetentSpec,
    DragOwnerInput,
    SheetEngine,
    SheetEngineConfig,
} from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(sheet).sort()).toEqual(
            [
                // Detent model
                'resolveDetents',
                'DEFAULT_DETENT_FRACTION',
                'DEFAULT_KEYBOARD_FALLBACK_PX',
                // Components
                'BottomSheet',
                'Backdrop',
                'SHEET_BACKDROP_MAX_OPACITY',
                // Engine
                'useSheetEngine',
                'SNAP_SEC',
                'SNAP_MS',
                // Pan gesture
                'createSheetPan',
                'MIN_DISTANCE',
                'RELEASE_SNAP',
                'RELEASE_DISMISS',
                // Pure math — release decisions, durations, drag ownership
                'projectReveal',
                'shouldDismiss',
                'nearestDetentIndex',
                'revealDurationSec',
                'decideDragOwner',
                'PROJECTION_SEC',
                'REVEAL_MIN_DURATION_SEC',
                'MAX_EPS_PX',
                'GRABBER_HEIGHT',
                'OWNER_UNDECIDED',
                'OWNER_SHEET',
                'OWNER_CONTENT',
            ].sort(),
        );
    });
});

describe('public types', () => {
    it('pins detent resolution as spec-array + env in, ascending px out', () => {
        // `specs` is optional-and-readonly on purpose: frontends pass a prop
        // straight through, and the resolver drops invalid entries rather
        // than throwing. Narrowing either side would break callers silently.
        expectTypeOf(sheet.resolveDetents).toEqualTypeOf<
            (specs: readonly DetentSpec[] | undefined, env: DetentEnv) => number[]
        >();
        // The resolved array crosses to the main thread; anything but plain
        // numbers would not survive the worklet copy.
        expectTypeOf<DetentSpec>().toEqualTypeOf<
            | number
            | { px: number }
            | { fraction: number }
            | { keyboard: true; fallbackPx?: number }
        >();
    });

    it('keeps the release math worklet-safe (numbers in, numbers out)', () => {
        // These run inside `'main thread'` bodies. A parameter or return that
        // became an object/union would force a deep copy across the thread
        // boundary per frame — the reason this logic is number-only at all.
        expectTypeOf(sheet.projectReveal).toEqualTypeOf<
            (revealPx: number, velocityY: number) => number
        >();
        expectTypeOf(sheet.shouldDismiss).toEqualTypeOf<
            (revealPx: number, velocityY: number, floorPx: number) => boolean
        >();
        expectTypeOf(sheet.nearestDetentIndex).toEqualTypeOf<
            (revealPx: number, velocityY: number, candidatesPx: readonly number[]) => number
        >();
        expectTypeOf(sheet.revealDurationSec).toEqualTypeOf<
            (heightFraction: number, fullSlideDurationSec: number) => number
        >();
    });

    it('keeps drag ownership a numeric state machine, not a string union', () => {
        // `OWNER_*` are plain numbers so they worklet-capture as literals, and
        // the flags in `DragOwnerInput` are `0 | 1` numbers matching the
        // SharedValues they are read from. Turning any of this into a string
        // union reads nicer and breaks on-device.
        expectTypeOf(sheet.decideDragOwner).toEqualTypeOf<(i: DragOwnerInput) => number>();
        expectTypeOf(sheet.OWNER_UNDECIDED).toEqualTypeOf<number>();
        expectTypeOf(sheet.OWNER_SHEET).toEqualTypeOf<number>();
        expectTypeOf(sheet.OWNER_CONTENT).toEqualTypeOf<number>();
        expectTypeOf<DragOwnerInput['currentOwner']>().toEqualTypeOf<number>();
    });

    it('pins the engine hook and its MT-owned handles (C8)', () => {
        // `reveal`/`combined`/`translateY` are SharedValues, NOT signals: the
        // pan writes `reveal` per frame on the main thread and the BG never
        // reads it for logic. `geomRef`/`drag` are MainThreadRefs for the same
        // reason — geometry reaches worklets only through `syncGeom`, never as
        // a BG lexical capture (#743).
        expectTypeOf(sheet.useSheetEngine).toEqualTypeOf<(cfg: SheetEngineConfig) => SheetEngine>();
        expectTypeOf<SheetEngine['reveal']>().toEqualTypeOf<SheetEngine['combined']>();
        expectTypeOf<SheetEngine['syncGeom']>().parameters.toEqualTypeOf<
            [min: number, max: number, ds: number[], dismissible: number, gate: number, bottomEdge: number]
        >();
        // `openToLift` is mount-constant: a boolean resolved once, not a
        // reactive read the frontend can flip after setup.
        expectTypeOf<SheetEngine['openToLift']>().toEqualTypeOf<boolean>();
    });

    it('keeps the drag-mode union complete', () => {
        // `<BottomSheet dragMode>` is mount-constant and consumers switch on
        // it; dropping a member is a silent behavior change at the call site.
        expectTypeOf<sheet.BottomSheetDragMode>().toEqualTypeOf<
            'surface' | 'handle' | 'grabber' | 'none'
        >();
    });
});
