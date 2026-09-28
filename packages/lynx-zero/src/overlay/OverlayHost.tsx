/**
 * The overlay system — the portal substitute a platform with no top layer
 * and no z-index needs. Stacking on lynx is DOCUMENT ORDER, so the only
 * correct place for a dialog is the LAST child of a full-surface positioned
 * container (the rule lynx-sheet's BottomSheet documents); rendering an
 * overlay in place breaks under any clipping or transformed ancestor.
 *
 * `ZeroRoot` is that container: the app wraps its page once, and it renders
 * the ThemeProvider host (so overlays inherit the theme tokens) with app
 * content FIRST and the outlet LAST. The outlet is a full-window
 * `position: fixed` layer (#1169) — lynx attaches fixed nodes to the page
 * root, after everything already there — so a backdrop dims the whole
 * screen even when the host itself sits inside safe-area padding, below a
 * header, or under a clipping navigation stack; the host's own box stays
 * the safe frame content respects (`useOverlayInsets`). The layer is
 * `pointer-events: none` and the root of every overlay opts back in with
 * `OVERLAY_ROOT_STYLE` (#1180). Overlay components register a
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
import type { Define, LayoutChangeEvent } from '@sigx/lynx';
import { component, createLogger, defineInjectable, defineProvide, effect, onUnmounted, signal, useScreen, useViewportRect } from '@sigx/lynx';
import { containedFrame, fixedOutletRect, provideOverlayOrigin, settleRect, tallestAtWidth } from '../behaviors/position.js';
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
 *     if (open()) portal.show(() => <view {...partBag(...)} style={{ ...OVERLAY_ROOT_STYLE, … }}>…</view>);
 *     else portal.hide();
 * });
 * ```
 */
/*
 * The closure's ROOT must carry `OVERLAY_ROOT_STYLE` (`pointer-events: auto`):
 * the outlet layer is `pointer-events: none`, lynx inherits the value, and a
 * root without its own would pass every touch to the page below (#1180).
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
 * The outlet layer: a ZERO-SIZE `position: fixed` node at the page root's
 * origin (fixed nodes attach to the page root, after the page's own
 * content), `overflow: visible`, so its children paint and hit-test out
 * across the window while the layer itself covers nothing.
 *
 * Zero-size is the native half of the pass-through contract (#1190).
 * `pointer-events: none` only steers LYNX's hit-test (taps). The native
 * one is UIKit's on iOS, and a full-window layer's own view was the deepest
 * view under every point: the page's scroll view never saw a pan while any
 * overlay was open. A 0×0 view contains no point, but its subviews are
 * still walked (lynx's view hit-test does not clip to the parent), so each
 * overlay still takes its own touches, natively and in lynx. The window's
 * size comes from `OUTLET_SIZER_STYLE`, and a root that fills the window
 * states that size itself (`useOutletFill`).
 *
 * The layer is ALWAYS mounted (#1181): it is inserted once, with the page,
 * and only toggles `display` as overlays come and go. Mounting and
 * unmounting a fixed node re-parents it to and from the page root every
 * time, and on iOS that churn left a second, stale copy of the last popup
 * painting over the page. A style flip never moves the node.
 */
const OUTLET_LAYER_STYLE = {
    position: 'fixed',
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    overflow: 'visible',
    pointerEvents: 'none',
} as const;

/**
 * The window-sized measuring node: `position: fixed` on all four edges, so
 * its layout size IS the outlet's size (`fixedOutletRect`). Childless, and
 * out of both hit-tests — `pointer-events: none` for lynx's,
 * `native-interaction-enabled={false}` for the platform's — so it never
 * holds a touch or a pan (#1190).
 */
const OUTLET_SIZER_STYLE = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none',
} as const;

/**
 * The hit-testing contract of the outlet (#1180). Both engines INHERIT
 * `pointer-events`: an element with no value of its own reports its
 * parent's (`LynxUI.pointerEvents` on iOS, `LynxBaseUI.pointerEvents()` on
 * Android). Under the layer's `none`, every overlay would report `none` too
 * and each tap would fall through to the page below — a Select item picking
 * the button under it, a dialog that cannot be closed. So the ROOT of every
 * portal closure states `pointer-events: auto` explicitly (lynx always
 * flushes an explicit `auto` to the platform): the overlay takes its own
 * touches, and a touch that misses every overlay lands on the bare layer,
 * which is `none`, and both engines retry it on the page underneath.
 *
 * Spread it into the root's inline style:
 * `style={{ ...OVERLAY_ROOT_STYLE, position: 'absolute', … }}`.
 */
export const OVERLAY_ROOT_STYLE = { pointerEvents: 'auto' } as const;

/**
 * The bare host: provides the registry, renders content first and the
 * outlet last. Use `ZeroRoot` unless the theme host already exists.
 */
export const OverlayHost = component<OverlayHostProps>(({ slots }) => {
    const registry = makeRegistry();
    defineProvide(useOverlayRegistry, () => registry);
    // Two rects (#1169). The OUTLET is a full-window layer: the host is laid
    // out inside whatever the app gives it — a SafeAreaView's padding, below
    // a navigation header, inside a Stack that clips its screens — and an
    // outlet confined to that box left a modal backdrop's inset strips
    // undimmed and cut a bottom toast's shadow at the home indicator. The
    // layer is `position: fixed`, which lynx attaches to the page root: it
    // escapes every clipping ancestor and fills the window. The host's own
    // box is the SAFE FRAME content respects (the dialog panel centers in
    // it, toasts pin to it, anchored popups clamp to it — #1086).
    //
    // The outlet's rect is NOT measured (#1181/#1182): a fixed layer pinned
    // to all four edges sits at the page root's origin by definition, and
    // the root is the space viewport rects are reported in. Measuring it on
    // iOS returned a shifted rect, which rejected the safe frame (toasts
    // under the status bar) and pushed anchored popups into the right-edge
    // clamp. Its size comes from the window-sized sizer's layout (the screen
    // until then) — the layer itself is 0×0 (#1190).
    //
    // Anchored popups measure in viewport coordinates and re-measure the
    // frame with their own rects (#1146): layout events never fire for a
    // transform.
    const frame = useViewportRect();
    const screen = useScreen();
    const outletSize = signal<{ value: { width: number; height: number } | null }>({ value: null });
    const outletRect = () => fixedOutletRect(outletSize.value, screen.value);
    // ONE function for every frame measurement: the settle clock dedupes a
    // batch by function identity, so this host's loop and every anchored
    // popup under it measure the frame once per batch (#1200).
    const measureFrame = (): void => frame.measure();
    // The outlet's no-keyboard height (#1232): the host lives as long as the
    // app, so the first layouts it sees are the window without a keyboard,
    // and an Android window that later shrinks for one keeps its full
    // height here — the dialog then knows the keyboard no longer overlaps.
    // Fed eagerly: a reader that only looked when a dialog opened over an
    // already-resized window would take the shrunken height as the full one.
    const tallest = tallestAtWidth();
    const feedTallest = effect(() => {
        tallest(outletRect());
    });
    onUnmounted(() => feedTallest.stop());
    provideOverlayOrigin(outletRect, measureFrame, () => frame.rect.value, () => tallest(outletRect()));
    // The frame is measured on LAYOUT, and a push transition is a transform:
    // the host inside a screen sliding in measures a screen width to the
    // right, pokes out of the outlet, and `containedFrame` drops it — every
    // toast lost its insets, and anchored popups their clamp box, because
    // nothing measured again once the slide settled (#1181, #1182). Keep
    // measuring until the frame holds still inside the outlet.
    settleRect(() => frame.rect.value, measureFrame, {
        unsettled: () => !containedFrame(outletRect(), frame.rect.value),
    });
    const onOutletLayout = (e: LayoutChangeEvent): void => {
        const d = e?.detail ?? e?.params;
        if (d && d.width > 0 && d.height > 0) {
            const prev = outletSize.value;
            if (!prev || prev.width !== d.width || prev.height !== d.height) {
                outletSize.value = { width: d.width, height: d.height };
            }
        }
        frame.measure();
    };
    // `display: flex` is load-bearing, not decoration: a lynx `<view>` defaults
    // to `display: linear`, which ignores its children's flex properties — the
    // app content below would size to itself and a `<ScrollView flex={1}>`
    // would never scroll (#1064).
    //
    // The layer is `display: none` while nothing is open, zero-size, and
    // `pointer-events: none` always: a layer that covered the window would
    // take every touch (iOS: every pan too) meant for the page under a
    // non-modal overlay (a toast). Each overlay's root opts back in with
    // `OVERLAY_ROOT_STYLE` (see there).
    return () => {
        const entries = registry.entries();
        return (
            <view
                main-thread:ref={frame.ref}
                bindlayoutchange={() => frame.measure()}
                style={{
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    flexGrow: 1,
                    flexShrink: 1,
                    flexBasis: '0%',
                    minHeight: 0,
                }}
            >
                {slots.default?.()}
                <view
                    bindlayoutchange={onOutletLayout}
                    native-interaction-enabled={false}
                    style={OUTLET_SIZER_STYLE}
                />
                <view style={{ ...OUTLET_LAYER_STYLE, display: entries.length > 0 ? 'flex' : 'none' }}>
                    {entries.map((entry) => (
                        <OverlayEntryBoundary key={entry.id} render={entry.render} />
                    ))}
                </view>
            </view>
        );
    };
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
