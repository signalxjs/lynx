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
 * Context flows lexically for the CLOSURE'S OWN reads — values captured at
 * the usage site work untouched. But components RENDERED BY the closure
 * (a Dialog.Close inside the popup) are new instances mounted under the
 * outlet, and their injections resolve against the OUTLET's provider chain
 * — the inert defaults. `PortalScope` closes that gap: the overlay captures
 * its contexts in setup and re-provides them inside the portal, so slot
 * content resolves exactly what it would have in place.
 *
 * Without a mounted host, `show()` warns in dev and renders nothing — the
 * failure is loud and names the fix (wrap the app in `<ZeroRoot>`), rather
 * than an overlay silently z-fighting in place.
 */
import type { Define } from '@sigx/lynx';
import { component, createLogger, defineInjectable, defineProvide, onUnmounted, signal } from '@sigx/lynx';
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
    // Mutations are deferred a microtask: an effect's FIRST run executes
    // inside the mount render pass, where sigx drops signal writes — an
    // overlay that is open at mount (a dialog rendered open) would silently
    // never appear. One microtask is sub-frame and makes show()/hide() safe
    // from any calling context.
    const defer = (mutate: () => void): void => {
        queueMicrotask(mutate);
    };
    const applyShow = (id: number, render: () => unknown): void => {
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
    };
    return {
        live: true,
        show(id, render) {
            defer(() => applyShow(id, render));
        },
        hide(id) {
            defer(() => {
                stack.entries = stack.entries.filter((e) => e.id !== id);
            });
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
    // Setup-scoped by contract (like every use*): the unmount hook is what
    // keeps an overlay from outliving its owner — a component that unmounts
    // while open must not leak its entry into the outlet forever.
    onUnmounted(() => registry.hide(id));
    return {
        show: (render) => registry.show(id, render),
        hide: () => registry.hide(id),
    };
}

/** @internal — whether a live host is reachable from this scope (tests). */
export function hasOverlayHost(): boolean {
    return useOverlayRegistry().live;
}

/**
 * A keyed identity boundary per overlay — no native wrapper element (the
 * closure's own root renders directly), but reconciliation now tracks each
 * overlay by its id, so an entry leaving mid-stack cannot make a later
 * overlay reconcile against the wrong node.
 */
type OverlayEntryProps = Define.Prop<'render', () => unknown, true>;
const OverlayEntryBoundary = component<OverlayEntryProps>(({ props }) => {
    // The registry stores render closures type-erased (`unknown` — the
    // authoring components own their JSX); this boundary is the one place
    // that re-asserts the JSX shape for the runtime.
    return () => props.render() as never;
}, { name: 'OverlayEntry' });

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
            {registry.entries().map((entry) => (
                <OverlayEntryBoundary key={entry.id} render={entry.render} />
            ))}
        </view>
    );
}, { name: 'OverlayHost' });

export type PortalScopeProps =
    /** Runs in THIS component's setup — call defineProvide/provide* here. */
    & Define.Prop<'setup', () => void, true>
    & Define.Prop<'render', () => unknown, true>;

/**
 * The context bridge for portaled slot content: an overlay captures what its
 * subtree needs (its own context object, the variant axes) and re-provides
 * it here, INSIDE the portal, so components rendered by the closure resolve
 * the same injections they would have in place.
 */
export const PortalScope = component<PortalScopeProps>(({ props }) => {
    props.setup();
    // Type-erased like OverlayEntryBoundary — the slot owns its JSX.
    return () => props.render() as never;
}, { name: 'PortalScope' });

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
