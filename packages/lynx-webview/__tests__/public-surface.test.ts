/**
 * Public-surface freeze test for @sigx/lynx-webview.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. Type-only
 *    exports (`WebViewProps`, `WebViewRef`, `SigxWebViewAttributes`, the three
 *    event shapes, …) are erased at runtime and are pinned below instead.
 *  - Types: the load-bearing signatures. This package has no `isAvailable`
 *    and no permissions to freeze; what a consumer actually builds against is
 *    the `WebViewMethods` bridge — the split between the fire-and-forget
 *    wrappers (`void`) and the async getters (`Promise<…>`), the `el | null`
 *    tolerance that lets call sites pass `ref.current` unguarded, and the
 *    `detail` payloads the event handlers receive.
 *
 * Note: this package has no `.web.ts` sibling — `<sigx-webview>` is a native
 * UI element with no web implementation — so there is no web-parity block
 * (D7.1b) to assert.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as webview from '../src/index.js';
import { WebViewMethods } from '../src/index.js';
import type { WebViewRef } from '../src/index.js';
import type {
    WebViewErrorEvent,
    WebViewLoadEvent,
    WebViewMessageEvent,
} from '../src/index.js';
import type { MainThread } from '@sigx/lynx';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(webview).sort()).toEqual(['WebView', 'WebViewMethods'].sort());
    });

    it('exposes exactly the documented imperative methods', () => {
        // These names are the wire contract with the native side: each key is
        // invoked by string through `Element.invoke(...)`, so a rename here
        // silently no-ops on device rather than failing to compile.
        expect(Object.keys(WebViewMethods).sort()).toEqual([
            'canGoBack',
            'canGoForward',
            'goBack',
            'goForward',
            'injectJavaScript',
            'postMessage',
            'reload',
            'stopLoading',
        ].sort());
    });
});

describe('public types', () => {
    it('keeps the fire-and-forget methods synchronous and null-tolerant', () => {
        // Returning `void` rather than a Promise is deliberate: these are
        // called from `'main thread'` worklet handlers, where an awaited or
        // unhandled rejection is a fatal MT exception. Accepting `null` is
        // what lets call sites pass `ref.current` without an `if`.
        expectTypeOf(WebViewMethods.goBack).toEqualTypeOf<(el: MainThread.Element | null) => void>();
        expectTypeOf(WebViewMethods.goForward).toEqualTypeOf<(el: MainThread.Element | null) => void>();
        expectTypeOf(WebViewMethods.reload).toEqualTypeOf<(el: MainThread.Element | null) => void>();
        expectTypeOf(WebViewMethods.stopLoading).toEqualTypeOf<(el: MainThread.Element | null) => void>();
        expectTypeOf(WebViewMethods.postMessage).toEqualTypeOf<
            (el: MainThread.Element | null, data: string) => void
        >();
    });

    it('pins the async getters to a total, never-rejecting result', () => {
        // The documented contract is that a missing element or a native
        // failure resolves to the default (`false` / `''`) instead of
        // rejecting. Widening these to `Promise<boolean | null>` or making
        // them throw would break every unguarded call site.
        expectTypeOf(WebViewMethods.canGoBack).toEqualTypeOf<
            (el: MainThread.Element | null) => Promise<boolean>
        >();
        expectTypeOf(WebViewMethods.canGoForward).toEqualTypeOf<
            (el: MainThread.Element | null) => Promise<boolean>
        >();
        expectTypeOf(WebViewMethods.injectJavaScript).toEqualTypeOf<
            (el: MainThread.Element | null, code: string) => Promise<string>
        >();
    });

    it('pins the event detail payloads', () => {
        // `onMessage` carries a string on the wire even when the page sent
        // JSON; typing it as `unknown` or a parsed object would be a silent
        // behavioral change for every consumer that calls `JSON.parse`.
        expectTypeOf<WebViewMessageEvent['detail']['data']>().toEqualTypeOf<string>();
        expectTypeOf<WebViewLoadEvent['detail']['url']>().toEqualTypeOf<string>();
        expectTypeOf<WebViewErrorEvent['detail']['message']>().toEqualTypeOf<string>();
        expectTypeOf<WebViewLoadEvent['type']>().toEqualTypeOf<'load'>();
        expectTypeOf<WebViewErrorEvent['type']>().toEqualTypeOf<'error'>();
        expectTypeOf<WebViewMessageEvent['type']>().toEqualTypeOf<'message'>();
    });

    it('keeps the ref a main-thread ref of a nullable element', () => {
        // `mtRef` is the only handle to the native element; if this stopped
        // being a `MainThreadRef` the `WebViewMethods.*(ref.current)` idiom
        // in the README would stop compiling for consumers, not for us.
        expectTypeOf<WebViewRef>().toEqualTypeOf<
            import('@sigx/lynx').MainThreadRef<MainThread.Element | null>
        >();
    });
});
