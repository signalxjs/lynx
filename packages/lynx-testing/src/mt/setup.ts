/**
 * Side-effect bootstrap for the main-thread (MT) gesture/worklet test
 * harness. Consumers list this in their `vitest.mt.config.ts`'s
 * `setupFiles` array; it must run before any test that drives a worklet
 * directly.
 *
 * ```ts
 * // vitest.mt.config.ts
 * import { defineConfig } from 'vitest/config';
 *
 * export default defineConfig({
 *   test: {
 *     environment: 'happy-dom',
 *     globals: true,
 *     include: ['__tests__/**\/*.mt.test.ts'],
 *     setupFiles: ['@sigx/lynx-testing/mt/setup'],
 *   },
 * });
 * ```
 *
 * Order matters and is encoded here:
 *   1. Stub PAPI globals (`__SetAttribute` etc.) + `globalThis.lynx` +
 *      `globalThis.SystemInfo`. The worklet-runtime IIFE reads
 *      `SystemInfo.lynxSdkVersion` at init and reassigns lynx.setTimeout /
 *      lynx.requestAnimationFrame onto globalThis, so both must exist
 *      before its IIFE evaluates.
 *   2. Side-effect import `@sigx/lynx-runtime-main` — its entry-main
 *      module installs `sigxRunOnMT`, `runOnBackground`, etc. (no PAPI
 *      calls fire at module init — only inside the renderPage /
 *      sigxPatchUpdate handlers we never invoke from these tests).
 *   3. Side-effect import `@lynx-js/react/worklet-runtime` — IIFE that
 *      installs `globalThis.lynxWorkletImpl`, `registerWorkletInternal`,
 *      `runWorklet`.
 *   4. Side-effect import `@sigx/lynx-runtime-main/install-hybrid-worklet`
 *      — registers the hybrid dispatcher into the now-populated
 *      `_workletMap`.
 *
 * The mocks are installed once per worker. `resetJsContextSpy()` from the
 * companion `@sigx/lynx-testing/mt` module wipes the dispatchEvent /
 * addEventListener spies between tests when needed.
 */

import { vi } from 'vitest';

interface JSContextMock {
    addEventListener: ReturnType<typeof vi.fn>;
    dispatchEvent: ReturnType<typeof vi.fn>;
}

let jsContext: JSContextMock = {
    addEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
};

const lynxMock = {
    SystemInfo: { lynxSdkVersion: '3.5.0' },
    getJSContext: () => jsContext,
    getCoreContext: () => jsContext,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
    requestAnimationFrame: (cb: FrameRequestCallback) => globalThis.setTimeout(() => cb(Date.now()), 16) as unknown as number,
    cancelAnimationFrame: (h: number) => globalThis.clearTimeout(h as unknown as ReturnType<typeof globalThis.setTimeout>),
    querySelector: (_sel: string) => null,
    querySelectorAll: (_sel: string) => [],
};

(globalThis as Record<string, unknown>)['lynx'] = lynxMock;
(globalThis as Record<string, unknown>)['SystemInfo'] = { lynxSdkVersion: '3.5.0' };

const noopPapi = vi.fn();
const papiKeys = [
    '__CreatePage',
    '__CreateView',
    '__SetCSSId',
    '__AppendElement',
    '__GetElementUniqueID',
    '__SetInlineStyles',
    '__SetStyle',
    '__AddInlineStyle',
    '__SetAttribute',
    '__AddEvent',
    '__GetAttributeByName',
    '__GetAttributeNames',
    '__GetComputedStyleByKey',
    '__QuerySelector',
    '__QuerySelectorAll',
    '__InvokeUIMethod',
    '__FlushElementTree',
    '__GetPageElement',
    '__ElementAnimate',
];
for (const k of papiKeys) {
    (globalThis as Record<string, unknown>)[k] = noopPapi;
}

await import('@sigx/lynx-runtime-main');
await import('@lynx-js/react/worklet-runtime');
await import('@sigx/lynx-runtime-main/install-hybrid-worklet');

// Internal — exposed through `@sigx/lynx-testing/mt` so tests can read or
// reset the JS-context spy between cases without re-stubbing the global.
export function _getJsContext(): JSContextMock {
    return jsContext;
}

export function _resetJsContextSpy(): void {
    jsContext = {
        addEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    };
    // Re-bind so `lynxMock.getJSContext()` / `getCoreContext()` return the
    // fresh spy instance (the closure captures `jsContext` by lexical
    // reference, so re-assigning it above is enough — but document this
    // here so future readers don't get confused if they refactor.)
}
