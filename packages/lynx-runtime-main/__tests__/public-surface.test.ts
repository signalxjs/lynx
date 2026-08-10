/**
 * Public-surface freeze test for @sigx/lynx-runtime-main.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. Type-only
 *    exports (`WorkletPlaceholder`) are erased at runtime and are pinned
 *    below instead.
 *  - Types: the load-bearing signatures. This package is renderer plumbing,
 *    not a native module — it has no `isAvailable` (C2), no permission
 *    methods (C6) and no hooks (C8). What it does have is a *cross-thread
 *    wire contract*: the ops applier, the snapshot-instance registry and the
 *    worklet/event-slot bridges are called from @sigx/lynx-runtime on the
 *    background thread and from generated main-thread bundles, neither of
 *    which this package's own typecheck covers. Those signatures are the ones
 *    frozen here.
 *
 * Note: importing the barrel runs `entry-main.js` for its side effects (it
 * installs `globalThis.renderPage` / `processData` / `sigxPatchUpdate`), so
 * the Lynx globals it reads at module-evaluation time are stubbed before the
 * dynamic import below — a static import would evaluate before any stubbing.
 *
 * This package ships no `.web.ts` sibling, so there is no web-parity block
 * (D7.1b) to assert.
 */
import { beforeAll, describe, expect, expectTypeOf, it, vi } from 'vitest';

import type * as RuntimeMain from '../src/index';
import type { WorkletPlaceholder } from '../src/worklet-events';

let mod: typeof RuntimeMain;

beforeAll(async () => {
    vi.stubGlobal('lynx', { SystemInfo: { lynxSdkVersion: '3.5.0' } });
    vi.stubGlobal('__FlushElementTree', vi.fn());
    mod = await import('../src/index');
});

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(mod).sort()).toEqual(
            [
                // Element registry — the BG-id → PAPI-handle map
                'elements',
                'pageUniqueId',
                'setPageUniqueId',
                // Ops applier — the entry point for every BG → MT patch
                'applyOps',
                'resetMainThreadState',
                // Snapshot-template instances (#620)
                'MTSnapshotInstance',
                'createSnapshotInstance',
                'destroySnapshotInstance',
                'ensureSyntheticId',
                'getSnapshotInstance',
                'installSnapshotMTHooks',
                'isSnapshotInstance',
                'resetSnapshotInstances',
                // Element wrapper handed to main-thread refs
                'MTElementWrapper',
                // Derived values
                'registerReducer',
                'lookupReducer',
                'resetReducers',
                'registerDerivedValue',
                'unregisterDerivedValue',
                'resetDerivedValues',
                'flushDerivedValues',
                'derivedValueCount',
                // Frame callbacks
                'registerFrameCallback',
                'setFrameCallbackActive',
                'unregisterFrameCallback',
                'resetFrameCallbacks',
                'frameCallbackCount',
                // Gesture parking
                'parkedGestureCount',
                'resetParkedGestures',
                // Worklet invocation + event slots
                'invokeWorklet',
                'setSlotWorklet',
                'setSlotBgSign',
                'flushDirtySlots',
                'resetSlotStates',
                // Hybrid (worklet + BG handler) dispatch
                'HYBRID_WORKLET_ID',
                'hybridCtx',
                'installHybridWorklet',
                // Compatibility shim for upstream's LEPUS output
                'loadWorkletRuntime',
            ].sort(),
        );
    });
});

describe('public types', () => {
    it('pins the ops-applier contract', () => {
        // `applyOps` is the whole BG → MT wire: @sigx/lynx-runtime hands it an
        // untyped tuple stream and Lynx's Lepus entry calls it via
        // `globalThis.sigxPatchUpdate`. Neither call site is typechecked
        // against this signature, so widening or narrowing it here is a
        // silent break.
        expectTypeOf(mod.applyOps).toEqualTypeOf<(ops: unknown[]) => void>();
        expectTypeOf(mod.resetMainThreadState).toEqualTypeOf<() => void>();
    });

    it('pins the element registry as a live map keyed by BG element id', () => {
        // Consumers (and the ops applier) look elements up by the *background*
        // thread's ShadowElement id; changing the key type breaks every
        // main-thread ref resolution at runtime only.
        expectTypeOf(mod.elements).toEqualTypeOf<Map<number, MainThreadElement>>();
        expectTypeOf(mod.setPageUniqueId).toEqualTypeOf<(id: number) => void>();
    });

    it('pins the worklet invocation bridge', () => {
        // `runOnMainThread` marshals (id, captured, args) across the thread
        // boundary; the captured-scope object is optional because event-driven
        // worklets arrive without one. Returns `unknown`, never a Promise —
        // main-thread execution is synchronous by definition.
        expectTypeOf(mod.invokeWorklet).toEqualTypeOf<
            (
                wkltId: string,
                captured: Record<string, unknown> | undefined,
                args: unknown[],
            ) => unknown
        >();
        expectTypeOf<WorkletPlaceholder>().toEqualTypeOf<{
            _wkltId: string;
            _c?: Record<string, unknown>;
        }>();
    });

    it('pins the event-slot setters as undefined-clearable', () => {
        // Passing `undefined` is how a handler is *removed*; if these tightened
        // to required arguments, detaching an event would become impossible and
        // stale worklets would keep firing on recycled list cells.
        expectTypeOf(mod.setSlotWorklet).toEqualTypeOf<
            (elId: number, type: string, name: string, ctx: WorkletPlaceholder | undefined) => void
        >();
        expectTypeOf(mod.setSlotBgSign).toEqualTypeOf<
            (elId: number, type: string, name: string, sign: string | undefined) => void
        >();
        expectTypeOf(mod.flushDirtySlots).toEqualTypeOf<() => void>();
    });

    it('pins the hybrid dispatch ctx shape', () => {
        // This object is handed straight to Lynx's `__AddEvent` PAPI, which
        // reads `_wkltId` / `_workletType` / `_c` by name. The literal
        // `'main-thread'` is load-bearing: the engine ignores any other value.
        expectTypeOf(mod.hybridCtx).toEqualTypeOf<
            (
                realCtx: WorkletPlaceholder,
                bgSign: string,
            ) => {
                _wkltId: string;
                _workletType: 'main-thread';
                _c: { realCtx: WorkletPlaceholder; bgSign: string };
            }
        >();
        // Frozen as-is, not endorsed: the id widens to `string` across the
        // barrel rather than keeping its literal type, so a typo in a consumer
        // comparing against it is not caught at compile time. Its runtime
        // value is asserted below instead.
        expectTypeOf(mod.HYBRID_WORKLET_ID).toEqualTypeOf<string>();
        expect(mod.HYBRID_WORKLET_ID).toBe('__sigx_hybrid_dispatch__');
    });

    it('pins derived-value registration as re-registrable by wvid', () => {
        // Re-registering the same `derivedWvid` swaps reducer/params while
        // keeping the SV identity — sheets rebind a reactive factor this way.
        // The signature is what makes that legal; a distinct `updateDerived`
        // would be a surface change, not an addition.
        expectTypeOf(mod.registerDerivedValue).toEqualTypeOf<
            (
                derivedWvid: number,
                reducerName: string,
                params: unknown,
                sourceWvids: number[],
            ) => void
        >();
        expectTypeOf(mod.unregisterDerivedValue).toEqualTypeOf<(derivedWvid: number) => void>();
    });

    it('pins the snapshot-instance lookups as nullable', () => {
        // A missing instance is normal (parked creates, #653 removal ordering),
        // so the lookup must stay `| undefined` rather than assert-non-null.
        expectTypeOf(mod.getSnapshotInstance).toEqualTypeOf<
            (id: number) => RuntimeMain.MTSnapshotInstance | undefined
        >();
        expectTypeOf(mod.isSnapshotInstance).toEqualTypeOf<(id: number) => boolean>();
    });
});
