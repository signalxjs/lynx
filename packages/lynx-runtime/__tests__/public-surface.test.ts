/**
 * Public-surface freeze test for @sigx/lynx-runtime.
 *
 * This is the background-thread renderer every sigx-on-Lynx app imports, and
 * its barrel is the entry point for the whole MTS/animated/threading API — a
 * removed or renamed export here breaks apps and half the `@sigx/lynx-*`
 * packages at once. Lock the surface so CI fails before the change reaches
 * consumers; when it changes intentionally, update both the value snapshot
 * and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-clipboard/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. The many
 *    type-only exports (`LynxNode`, `ViewAttributes`, `FrameInfo`, …) are
 *    erased at runtime and never appear here.
 *  - Types: the load-bearing signatures only. This package has no
 *    `isAvailable` and no permission methods, so the conventions that bite
 *    here are C7 (a subscription-like handle hands back a disposer) and C8
 *    (the `SharedValue`/main-thread suffixes have to keep meaning what they
 *    say — an MT-only handle must not decay into a plain object, and the
 *    thread-hop helpers must keep returning `Promise`s).
 *
 * Note: this package ships no `.web.ts` sibling — the web target runs the
 * same background-thread renderer — so there is no web-parity block (D7.1b).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as runtime from '../src/index';
import {
    MainThreadRef,
    SharedValue,
    runOnBackground,
    runOnMainThread,
    useFrameCallback,
    useMainThreadRef,
    useSharedValue,
} from '../src/index';
import type {
    ElementLayout,
    FrameCallback,
    FrameInfo,
    UseElementLayoutResult,
    UseViewportRectResult,
    ViewportRect,
} from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(runtime).sort()).toEqual(
            [
                // Renderer entry points + node ops
                'render',
                'lynxMount',
                'nodeOps',
                'resetNodeOpsState',
                // Main-thread shadow tree
                'ShadowElement',
                'createPageRoot',
                'resetShadowState',
                'ShadowSlotElement',
                'ShadowSnapshotElement',
                'isShadowSlotElement',
                'isShadowSnapshotElement',
                'normalizeHole',
                'releaseHoleValues',
                'wireEqual',
                // use:* directive system + the built-in `show`
                'show',
                // DOM-runtime compat names for the @sigx/runtime-dom alias (#1059)
                'Portal',
                'moveNode',
                'supportsMoveBefore',
                'useHead',
                'registerBuiltInDirective',
                'resolveBuiltInDirective',
                'patchDirective',
                'onElementMounted',
                'onElementUnmounted',
                // BG → MT op queue
                'pushOp',
                'takeOps',
                'scheduleFlush',
                'flushNow',
                'resetOpQueue',
                'waitForFlush',
                'pendingOps',
                'OP',
                // Event registry (MT worklets → BG handlers)
                'register',
                'updateHandler',
                'unregister',
                'getHandler',
                'publishEvent',
                'resetRegistry',
                // Main Thread Script (MTS) refs
                'MainThreadRef',
                'useMainThreadRef',
                'resetWvidCounter',
                // Layout + viewport measurement
                'useElementLayout',
                'measureViewportRect',
                'useViewportRect',
                // Per-frame MT callbacks
                'useFrameCallback',
                'startFrameCallback',
                'stopFrameCallback',
                'resetFrameCallbackIds',
                // Animated value bridge (MT → BG publishes)
                'registerBgSink',
                'unregisterBgSink',
                'ingestAvPublishes',
                'resetBgAvBridge',
                'bgAvSinkCount',
                // Animated: shared values, styles, methods, derived values
                'useSharedValue',
                'SharedValue',
                'useAnimatedStyle',
                'resetAnimatedStyleBindingIds',
                'useAnimatedMethod',
                'resetAnimatedMethodBindingIds',
                'useDerivedValue',
                'useDerivedValueReactive',
                'useScrollDragHost',
                'useCreateScrollDragHost',
                // Deprecated since Phase 2.8 — superseded by SharedValue.
                // Frozen here so its eventual removal is a deliberate,
                // reviewed edit rather than a silent break.
                'useAnimatedValue',
                'AnimatedValue',
                // Cross-thread invocation
                'runOnMainThread',
                'runOnBackground',
                'resetThreading',
                'transformToWorklet',
                'resetRunOnBackgroundState',
                // Native gesture detector
                'Gesture',
                'GestureType',
                'useGestureDetector',
                'resetGestureIdCounter',
            ].sort(),
        );
    });
});

describe('public types', () => {
    it('keeps the thread hops promise-returning (C8)', () => {
        // Both directions are async because the payload crosses a thread
        // boundary; a worklet's return value never comes back. If either
        // signature ever went synchronous, every `await runOnMainThread(...)`
        // call site would keep compiling while sequencing silently changed.
        expectTypeOf(runOnMainThread<[number, string]>).returns.toEqualTypeOf<
            (a: number, b: string) => Promise<unknown>
        >();
        expectTypeOf(runOnBackground<number, (n: number) => number>).returns.toEqualTypeOf<
            (n: number) => Promise<number>
        >();
    });

    it('keeps main-thread handles typed as their class, not a plain object (C8)', () => {
        // `useMainThreadRef` / `useSharedValue` return class instances whose
        // identity the SWC worklet transform depends on: only a real
        // `MainThreadRef` gets serialised into a worklet's `_c` as a wire id
        // rather than deep-copied. Widening the return to `{ current: T }`
        // would typecheck everywhere and break every worklet capture.
        expectTypeOf(useMainThreadRef<number>).returns.toEqualTypeOf<MainThreadRef<number>>();
        expectTypeOf(useSharedValue<number>).returns.toEqualTypeOf<SharedValue<number>>();
        // A SharedValue *is* a MainThreadRef — that inheritance is what lets
        // it be captured by worklets at all.
        expectTypeOf<SharedValue<number>>().toExtend<MainThreadRef<{ value: number }>>();
    });

    it('keeps the frame callback disposable (C7)', () => {
        // The only leak-proofing a module-scope frame loop has: `dispose()`
        // must stay on the handle and stay `void`-returning, since `useFrameCallback`
        // returns the handle rather than a bare unsubscribe function.
        expectTypeOf(useFrameCallback).returns.toEqualTypeOf<FrameCallback>();
        expectTypeOf<FrameCallback['dispose']>().toEqualTypeOf<() => void>();
        expectTypeOf<FrameCallback['start']>().toEqualTypeOf<() => void>();
        expectTypeOf<FrameCallback['stop']>().toEqualTypeOf<() => void>();
        expectTypeOf<FrameInfo>().toHaveProperty('timestamp');
    });

    it('keeps measurement results nullable until the first frame lands', () => {
        // `null` means "not measured yet", and both hooks make the consumer
        // handle it. Collapsing either to a non-null default would hide
        // cold-start misplacement behind a zero rect.
        // Asserted purely at the type level: `expectTypeOf`'s argument is
        // still *evaluated* at runtime, and these hooks touch the MT bridge.
        expectTypeOf<UseElementLayoutResult['layout']['value']>().toEqualTypeOf<
            ElementLayout | null
        >();
        expectTypeOf<UseViewportRectResult['rect']>().toEqualTypeOf<
            SharedValue<ViewportRect | null>
        >();
        expectTypeOf<UseViewportRectResult['measure']>().toEqualTypeOf<() => void>();
    });
});
