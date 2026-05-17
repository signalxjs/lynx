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
 * Usage:
 *
 * ```tsx
 * const chrome = useScreenChrome();
 * return () => {
 *   if (!chrome.headerShown) return null;
 *   return (
 *     <view class="…themed…">
 *       {chrome.headerLeft?.() ?? (chrome.canGoBack ? <BackButton onPress={chrome.pop} /> : null)}
 *       <text>{chrome.title}</text>
 *       {chrome.headerRight?.()}
 *     </view>
 *   );
 * };
 * ```
 *
 * Every property on the returned object is a getter — reading it inside
 * a render function or `computed` subscribes to the underlying signal,
 * so the consumer re-renders when title / slots change.
 */
import { useNav } from './use-nav.js';
import { useNavInternals } from './use-nav-internal.js';
import type { ScreenSlotFills } from '../types.js';

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

    return {
        get title() {
            const entry = nav.current;
            const reg = internals.screens.get(entry.key);
            const t = reg?.options.title;
            if (typeof t === 'function') return t();
            if (typeof t === 'string') return t;
            return entry.route;
        },
        get headerShown() {
            const reg = internals.screens.get(nav.current.key);
            return reg?.options.headerShown !== false;
        },
        get canGoBack() {
            return nav.canGoBack;
        },
        pop() {
            nav.pop();
        },
        get header() {
            const reg = internals.screens.get(nav.current.key);
            return reg?.slots.header;
        },
        get headerLeft() {
            const reg = internals.screens.get(nav.current.key);
            return reg?.slots.headerLeft;
        },
        get headerRight() {
            const reg = internals.screens.get(nav.current.key);
            return reg?.slots.headerRight;
        },
    };
}
