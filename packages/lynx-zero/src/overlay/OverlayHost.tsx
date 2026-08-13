/**
 * The overlay system — the portal substitute a platform with no top layer
 * and no z-index needs. Stacking on lynx is DOCUMENT ORDER, so the only
 * correct place for a dialog is the LAST child of a full-surface positioned
 * container (the rule lynx-sheet's BottomSheet documents); rendering an
 * overlay in place breaks under any clipping or transformed ancestor.
 *
 * `ZeroRoot` is that container: the app wraps its page once, and it renders
 * the ThemeProvider host (so overlays inherit the theme tokens) with app
 * content FIRST and `<OverlayOutlet/>` LAST. Overlay components register a
 * render closure through `useOverlayPortal()`; the outlet maps the stack in
 * registration order — later registration paints on top, which matches the
 * dismiss stack's innermost-first order by construction.
 *
 * Context flows lexically: the closure is created at the usage site, so the
 * injections it reads resolved there — a Dialog's own provided context
 * reaches its portaled popup without any re-providing machinery.
 *
 * Without a mounted host, `show()` warns in dev and renders nothing — the
 * failure is loud and names the fix (wrap the app in `<ZeroRoot>`), rather
 * than an overlay silently z-fighting in place.
 */
import type { Define } from '@sigx/lynx';
import { component, createLogger, defineInjectable, defineProvide, signal } from '@sigx/lynx';
import type { ThemeProviderProps } from '../theme/ThemeProvider.js';
import { ThemeProvider } from '../theme/ThemeProvider.js';

const log = createLogger('lynx-zero');

/** One registered overlay: a stable identity and its render closure. */
interface OverlayEntry {
    id: number;
    render: () => unknown;
}

interface OverlayRegistry {
    /** True when a real host is mounted (the default registry is inert). */
    live: boolean;
    show(id: number, render: () => unknown): void;
    hide(id: number): void;
    entries(): OverlayEntry[];
}

let nextOverlayId = 1;

const inertRegistry: OverlayRegistry = {
    live: false,
    show() {
        log.warn(
            'an overlay tried to open with no <ZeroRoot> (or <OverlayHost>) mounted — '
            + 'wrap the app once so overlays can render above everything; nothing was rendered',
        );
    },
    hide() {},
    entries: () => [],
};

const useOverlayRegistry = defineInjectable<OverlayRegistry>(() => inertRegistry);

function makeRegistry(): OverlayRegistry {
    // Object signal so the entry list is reactive; replaced wholesale on
    // every change (splice-in-place would not notify).
    const stack = signal<{ entries: OverlayEntry[] }>({ entries: [] });
    return {
        live: true,
        show(id, render) {
            // Update IN PLACE when already open — show() must be idempotent
            // for ordering, because an effect that calls it re-runs on
            // unrelated signal writes (object signals track coarsely) and a
            // re-append would reshuffle the stack under the user's fingers.
            // A layer that genuinely wants the top (the toast viewport)
            // hides and re-shows.
            const existing = stack.entries.findIndex((e) => e.id === id);
            stack.entries = existing === -1
                ? [...stack.entries, { id, render }]
                : stack.entries.map((e, i) => (i === existing ? { id, render } : e));
        },
        hide(id) {
            stack.entries = stack.entries.filter((e) => e.id !== id);
        },
        entries: () => stack.entries,
    };
}

export interface OverlayPortal {
    /** Mount this overlay's content in the outlet (position-stable when already open). */
    show(render: () => unknown): void;
    /** Remove it. Also runs automatically on unmount. */
    hide(): void;
}

/**
 * The portal handle for one overlay component. Call in setup; drive from
 * the open state:
 *
 * ```tsx
 * const portal = useOverlayPortal();
 * effect(() => {
 *     if (open()) portal.show(() => <view {...partBag(...)}>…</view>);
 *     else portal.hide();
 * });
 * ```
 */
export function useOverlayPortal(): OverlayPortal {
    const registry = useOverlayRegistry();
    const id = nextOverlayId++;
    return {
        show: (render) => registry.show(id, render),
        hide: () => registry.hide(id),
    };
}

/** @internal — whether a live host is reachable from this scope (tests). */
export function hasOverlayHost(): boolean {
    return useOverlayRegistry().live;
}

type OverlayHostProps = Define.Slot<'default'>;

/**
 * The bare host: provides the registry, renders content first and the
 * outlet last. Use `ZeroRoot` unless the theme host already exists.
 */
export const OverlayHost = component<OverlayHostProps>(({ slots }) => {
    const registry = makeRegistry();
    defineProvide(useOverlayRegistry, () => registry);
    return () => (
        <view style={{ position: 'relative', flexGrow: 1, flexShrink: 1, flexBasis: '0%', minHeight: 0 }}>
            {slots.default?.()}
            {registry.entries().map((entry) => entry.render())}
        </view>
    );
}, { name: 'OverlayHost' });

export type ZeroRootProps = ThemeProviderProps;

/**
 * The one required app wrapper: the ThemeProvider host (`zx-root` +
 * `zx-theme-<name>` classes, so overlays inherit the theme tokens) around
 * the overlay host.
 */
export const ZeroRoot = component<ZeroRootProps>(({ props, slots }) => {
    return () => (
        <ThemeProvider
            initial={props.initial}
            light={props.light}
            dark={props.dark}
            fontScale={props.fontScale}
            class={props.class}
            style={props.style}
        >
            <OverlayHost>{slots.default?.()}</OverlayHost>
        </ThemeProvider>
    );
}, { name: 'ZeroRoot' });
