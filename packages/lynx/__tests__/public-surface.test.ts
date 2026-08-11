/**
 * Public-surface freeze test for `@sigx/lynx` (rubric D7.1).
 *
 * `@sigx/lynx` is the umbrella import — `import { component, signal, fetch }
 * from '@sigx/lynx'` is the only import most apps ever write. Almost none of
 * this surface is defined here: it is re-exported wholesale from
 * `@sigx/reactivity`, `@sigx/runtime-core`, `@sigx/lynx-runtime`,
 * `@sigx/lynx-core` and `@sigx/lynx-http`. That is exactly why the freeze
 * matters more here than in a leaf package: a rename or a dropped export three
 * packages down, or a catalog bump of `@sigx/runtime-core`, silently changes
 * what every app can import. Freezing the barrel makes that break CI here
 * instead of in a consumer's build.
 *
 * The list below is the surface AS IT IS TODAY, not the surface as it should
 * be — several plainly internal helpers (`resetOpQueue`, `pushOp`/`takeOps`,
 * `resetThreading`, the `__`-prefixed HMR hooks, …) reach consumers through
 * `export *`. They are frozen deliberately; narrowing them is the owning
 * audit issue's call, not this test's.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. Type-only
 *    exports do not appear here — they are pinned below instead.
 *  - Types: the load-bearing signatures, chosen for the conventions they
 *    encode (C2 availability, C8 `MT` suffix) and for what would silently
 *    misbehave rather than fail loudly if it drifted.
 *
 * When the surface changes intentionally, update the snapshot and the type
 * assertions here in the same PR.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as http from '@sigx/lynx-http';
import * as mod from '../src/index';
import type { Computed, OrientationLock, ScreenMetrics } from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(mod).sort()).toEqual([
            'AnimatedValue',
            'Breakpoint',
            'Comment',
            'ComputedSymbol',
            'Defer',
            'DeviceInfo',
            'FormData',
            'Fragment',
            'Gesture',
            'GestureType',
            'Headers',
            'MainThreadRef',
            'OP',
            'Orientation',
            'Platform',
            'Response',
            'ShadowElement',
            'ShadowSlotElement',
            'ShadowSnapshotElement',
            'SharedValue',
            'SigxError',
            'SigxErrorCode',
            'SubscriptionHandler',
            'SupersededError',
            'Text',
            'TextDecoder',
            'Utils',
            '__registerComponentPlugin',
            '__setCurrentInstanceForHMR',
            'addTransport',
            'all',
            'asyncSetupClientError',
            'batch',
            'bgAvSinkCount',
            'clearTransports',
            'component',
            'compound',
            'computed',
            'consoleTransport',
            'createLogger',
            'createModel',
            'createModelFromBinding',
            'createPageRoot',
            'createTopic',
            'createTopicGroup',
            'defineApp',
            'defineDirective',
            'defineFactory',
            'defineInjectable',
            'defineProvide',
            'detectAccess',
            'detectAccessDev',
            'disableNamespace',
            'effect',
            'effectScope',
            'enableNamespace',
            'errorScope',
            'errorScopeOutsideSetupError',
            'fetch',
            'flushNow',
            'getComponentMeta',
            'getCurrentInstance',
            'getHandler',
            'getLogLevel',
            'guid',
            'heightClassOf',
            'ingestAvPublishes',
            'isBaseBuild',
            'isComponent',
            'isComputed',
            'isDirective',
            'isHttpAvailable',
            'isLazyComponent',
            'isModel',
            'isPromise',
            'isReactive',
            'isShadowSlotElement',
            'isShadowSnapshotElement',
            'isSignal',
            'isVariant',
            'jsx',
            'jsxDEV',
            'jsxs',
            'lazy',
            'lynxMount',
            'measureViewportRect',
            'mergeProps',
            'mountTargetNotFoundError',
            'noMountFunctionError',
            'nodeOps',
            'normalizeHole',
            'onCreated',
            'onElementMounted',
            'onElementUnmounted',
            'onMounted',
            'onScopeDispose',
            'onUnmounted',
            'onUpdated',
            'patchDirective',
            'pendingOps',
            'provideInvalidInjectableError',
            'provideOutsideSetupError',
            'publishEvent',
            'pushOp',
            'readGlobalFontScale',
            'readGlobalScreen',
            'register',
            'registerBgSink',
            'registerBuiltInDirective',
            'registerModelModifier',
            'registerModelProcessor',
            'releaseHoleValues',
            'render',
            'renderTargetNotFoundError',
            'requiredInjectableNotProvidedError',
            'resetAnimatedMethodBindingIds',
            'resetAnimatedStyleBindingIds',
            'resetBgAvBridge',
            'resetFrameCallbackIds',
            'resetGestureIdCounter',
            'resetNodeOpsState',
            'resetOpQueue',
            'resetRegistry',
            'resetRunOnBackgroundState',
            'resetShadowState',
            'resetThreading',
            'resetWvidCounter',
            'resolveBuiltInDirective',
            'runOnBackground',
            'runOnMainThread',
            'scheduleFlush',
            'setLogLevel',
            'show',
            'signal',
            'startFrameCallback',
            'stopFrameCallback',
            'takeOps',
            'toRaw',
            'toSignal',
            'toSignals',
            'toSubscriber',
            'transformToWorklet',
            'unregister',
            'unregisterBgSink',
            'untrack',
            'updateHandler',
            'useAction',
            'useAnimatedMethod',
            'useAnimatedStyle',
            'useAnimatedValue',
            'useAppContext',
            'useCreateScrollDragHost',
            'useData',
            'useDerivedValue',
            'useDerivedValueReactive',
            'useElementLayout',
            'useFontScale',
            'useFontScaleMT',
            'useFrameCallback',
            'useGestureDetector',
            'useHeightAtLeast',
            'useHeightClass',
            'useHeightClassMT',
            'useMainThreadRef',
            'useOrientation',
            'useOrientationLock',
            'useScreen',
            'useScreenMT',
            'useScrollDragHost',
            'useSharedValue',
            'useStream',
            'useViewportRect',
            'useWidthAtLeast',
            'useWidthClass',
            'useWidthClassMT',
            'variant',
            'waitForFlush',
            'watch',
            'widthClassOf',
            'wireEqual',
        ]);
    });

    it('binds `fetch` to the sigx implementation, not the engine factory param', () => {
        // The whole reason the umbrella re-exports networking (#373, #378):
        // on the Lynx BG runtime a bare `fetch` resolves to the engine's
        // non-WHATWG factory parameter, whose `Response` has no `.headers`.
        // If this re-export ever came from somewhere else, apps would get the
        // engine's fetch back without a single type error.
        expect(mod.fetch).toBe(http.fetch);
        expect(mod.Response).toBe(http.Response);
    });
});

describe('public types', () => {
    it('keeps the availability check synchronous and boolean (C2)', () => {
        // A Promise-returning availability check makes `if (isHttpAvailable())`
        // always truthy — the drift that already happened in lynx-biometric.
        expectTypeOf(mod.isHttpAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(mod.isHttpAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });

    it('keeps the `MT` suffix meaning "plain value, read now" (C8)', () => {
        // The suffix is the entire contract: worklet bodies cannot hold a
        // reactive `Computed`, so the MT variants must stay unwrapped, and the
        // BG variants must stay reactive. Swapping either silently breaks the
        // side that reads it — a `Computed` in a worklet, or a value that
        // never updates on rotation.
        expectTypeOf(mod.useScreen).returns.toEqualTypeOf<Computed<ScreenMetrics>>();
        expectTypeOf(mod.useScreenMT).returns.toEqualTypeOf<ScreenMetrics>();
        expectTypeOf(mod.useFontScale).returns.toEqualTypeOf<Computed<number>>();
        expectTypeOf(mod.useFontScaleMT).returns.toEqualTypeOf<number>();
    });

    it('pins the orientation surface (#856)', () => {
        // `Orientation` is the imperative service; both calls are awaited by
        // callers that need to know the lock took, so they must stay Promises.
        expectTypeOf(mod.Orientation.lock).toEqualTypeOf<(to: OrientationLock) => Promise<void>>();
        expectTypeOf(mod.Orientation.unlock).toEqualTypeOf<() => Promise<void>>();
        // The hook is mount-scoped rather than handle-based on purpose: the
        // release is driven by `onUnmounted`, so it returns nothing to hold.
        expectTypeOf(mod.useOrientationLock).toEqualTypeOf<(to: OrientationLock) => void>();
    });

    it('pins the logger factory', () => {
        // `createLogger` is the one blessed path to logging from app code;
        // the low-level bridge stays internal to @sigx/lynx-core.
        expectTypeOf(mod.createLogger).parameters.toEqualTypeOf<[string]>();
        expectTypeOf(mod.createLogger).returns.toEqualTypeOf<mod.Logger>();
    });
});
