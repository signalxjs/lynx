/**
 * `useScreenChrome` — reactive read of the currently-focused screen's
 * options + slot fills, plus navigation helpers a header would need
 * (canGoBack, pop).
 *
 * The built-in `<Header />` reads this same data via internal hooks.
 * `useScreenChrome` exposes it as a public API so theme packages
 * (`@sigx/lynx-daisyui`, custom designs) can build their own header
 * components without depending on internal modules.
 *
 * Resolution rules:
 *
 *  - **Inside a screen body** (i.e. inside an EntryScope whose entry is
 *    on the nearest `useNav()`'s stack), bind to **this entry's**
 *    registry. Useful for modal screens that render their own
 *    NavHeader inside — the chrome slides with the sheet.
 *  - **Outside any matching EntryScope** (slot of `<Stack>`, persistent
 *    root-level Header, etc.), bind to the *destination* entry of the
 *    current nav state — what the navigator is settling on once the
 *    in-flight transition completes. Push: the new top (already at
 *    nav.current). Pop: the entry being revealed
 *    (`transition.underneathEntry`), *not* the one being animated off.
 *    Using the destination means the bar reflects what the user is
 *    navigating *to*, immediately, with no end-of-animation snap.
 *
 * Every property is a getter — reading inside a render / `computed`
 * subscribes to the underlying signal, so consumers re-render when
 * title / slots change.
 */
import { useNav } from './use-nav.js';
import { useCurrentEntryOptional, useNavInternals } from './use-nav-internal.js';
import type { ScreenSlotFills, StackEntry } from '../types.js';

export interface ScreenChrome {
    /** Resolved screen title — `options.title` (string or getter) or the route name as fallback. Reactive. */
    readonly title: string;
    /** Whether the header should render. Defaults to true unless the screen set `headerShown: false`. Reactive. */
    readonly headerShown: boolean;
    /** True when the current stack has more than one entry — i.e. there's something to pop back to. Reactive. */
    readonly canGoBack: boolean;
    /** Pop the top entry. No-op when `!canGoBack`. */
    pop(): void;
    /** Full header override slot, if `<Screen.Header>` was set. Render its return value in place of the default layout. */
    readonly header: ScreenSlotFills['header'] | undefined;
    /** Left-aligned slot (typically a back button). Reactive. */
    readonly headerLeft: ScreenSlotFills['headerLeft'] | undefined;
    /** Right-aligned slot (typically actions). Reactive. */
    readonly headerRight: ScreenSlotFills['headerRight'] | undefined;
}

export function useScreenChrome(): ScreenChrome {
    const nav = useNav();
    const internals = useNavInternals();

    // The candidate "scoped" entry, if we happen to be rendered inside
    // an EntryScope. May belong to a DIFFERENT nav than `nav` — e.g.
    // when NavHeader is placed in a per-tab `<Stack>`'s chrome slot,
    // it sees the outer (root) EntryScope's entry but its `useNav()`
    // returns the inner per-tab nav. We only honor the pin when the
    // entry is actually on this nav's stack; otherwise we're crossing
    // scopes and the destination-entry path is correct.
    //
    // `useCurrentEntryOptional` is the soft companion to
    // `useCurrentEntry` — it returns `null` outside any EntryScope
    // rather than throwing, which is the right semantic for a chrome
    // consumer that *might* be a Stack slot.
    const candidate: StackEntry | null = useCurrentEntryOptional();

    const getDestinationEntry = (): StackEntry => {
        const t = nav.transition;
        if (t) {
            return t.kind === 'pop' ? t.underneathEntry : t.topEntry;
        }
        return nav.current;
    };

    const getEntry = (): StackEntry => {
        if (candidate) {
            const stack = nav.stack;
            if (stack.some((e) => e.key === candidate!.key)) {
                return candidate;
            }
        }
        return getDestinationEntry();
    };

    return {
        get title() {
            const entry = getEntry();
            const reg = internals.screens.get(entry.key);
            const t = reg?.options.title;
            if (typeof t === 'function') return t();
            if (typeof t === 'string') return t;
            return entry.route;
        },
        get headerShown() {
            const reg = internals.screens.get(getEntry().key);
            return reg?.options.headerShown !== false;
        },
        get canGoBack() {
            const entry = getEntry();
            const stack = nav.stack;
            const idx = stack.findIndex((e) => e.key === entry.key);
            return idx > 0;
        },
        pop() {
            nav.pop();
        },
        get header() {
            const reg = internals.screens.get(getEntry().key);
            return reg?.slots.header;
        },
        get headerLeft() {
            const reg = internals.screens.get(getEntry().key);
            return reg?.slots.headerLeft;
        },
        get headerRight() {
            const reg = internals.screens.get(getEntry().key);
            return reg?.slots.headerRight;
        },
    };
}
