/**
 * Public-surface freeze test for @sigx/lynx-list.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. Type-only
 *    exports (`ListProps`, `ListRef`, `ListScrollHandle`, `ListType`,
 *    `ListItemSnap`, `ScrollAlign`, `ScrollToIndexOptions`) are erased at
 *    runtime and are pinned below instead.
 *  - Types: the load-bearing signatures. This package exposes no
 *    `isAvailable` (C2), no permissions (C6) and no event subscriptions (C7) —
 *    it is a component package, so the contracts worth freezing are the
 *    main-thread handle shapes (C8) and the imperative scroll surface, both of
 *    which are called from inside `'main thread'` worklet bodies where a
 *    signature drift is a device-only failure.
 *
 * Note: this package has no `.web.ts` sibling, so there is no web-parity
 * block (D7.1b) to assert.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { MainThread, MainThreadRef } from '@sigx/lynx';

import * as list from '../src/index';
import { ListMethods, SCROLL_METHOD } from '../src/index';
import type {
    ListRef,
    ListScrollHandle,
    ListType,
    ScrollAlign,
    ScrollToIndexOptions,
} from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(list).sort()).toEqual(
            [
                // The component itself
                'List',
                // Imperative main-thread scroll helpers
                'ListMethods',
                // The native UI-method name, exported so chat-mode worklets in
                // consumer code share the one device-verified constant.
                'SCROLL_METHOD',
            ].sort(),
        );
    });

    it('exposes exactly the documented ListMethods helpers', () => {
        // A new helper reaching consumers unannounced is the thing this
        // catches; the README API table has to grow with it.
        expect(Object.keys(ListMethods).sort()).toEqual(['scrollToIndex', 'scrollToTop']);
    });
});

describe('public types', () => {
    it('pins the imperative scroll signatures', () => {
        // These run inside main-thread event handlers, so they must stay
        // null-tolerant (call sites pass `ref.current` directly) and must
        // return `void` — a Promise here would surface as an unhandled
        // rejection on device rather than a test failure.
        expectTypeOf(ListMethods.scrollToIndex).toEqualTypeOf<
            (el: MainThread.Element | null, index: number, opts?: ScrollToIndexOptions) => void
        >();
        expectTypeOf(ListMethods.scrollToTop).toEqualTypeOf<
            (el: MainThread.Element | null, opts?: { smooth?: boolean }) => void
        >();
        expectTypeOf<ScrollAlign>().toEqualTypeOf<'top' | 'bottom' | 'middle'>();
    });

    it('keeps SCROLL_METHOD a literal, not a widened string', () => {
        // Consumers invoke this name on the native element; widening to
        // `string` would let a typo through, and the value itself is the
        // single device-verification point for the `<list>` scroll contract.
        // `typeof` rather than passing the value: generic inference from a
        // string argument widens it to `string`, which would make the pin
        // pass no matter what the constant is declared as.
        expectTypeOf<typeof SCROLL_METHOD>().toEqualTypeOf<'scrollToPosition'>();
        expect(SCROLL_METHOD).toBe('scrollToPosition');
    });

    it('keeps the main-thread ref a raw element handle (C8)', () => {
        // `mtRef` is read as `ref.current` inside a `'main thread'` worklet,
        // so it has to stay a `MainThreadRef` of the native element — not a
        // signal, not a wrapper object. The `null` arm is load-bearing: the
        // ref is empty before mount and after unmount.
        expectTypeOf<ListRef>().toEqualTypeOf<MainThreadRef<MainThread.Element | null>>();
    });

    it('keeps the scroll handle nullable and fire-and-forget', () => {
        // `scrollToEnd` is assigned during the List's setup, so it is `null`
        // until then — collapsing the null away would invite call sites to
        // drop the `?.` and crash on the first pre-mount call.
        expectTypeOf<ListScrollHandle>().toEqualTypeOf<{
            scrollToEnd: ((opts?: { smooth?: boolean }) => void) | null;
        }>();
    });

    it('pins the layout mode union', () => {
        // Adding a mode is a native-side contract change; a consumer's
        // exhaustive switch over these should break loudly when it happens.
        expectTypeOf<ListType>().toEqualTypeOf<'single' | 'flow' | 'waterfall'>();
    });
});
