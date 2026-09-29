/**
 * Drawer — zero's edge panel on lynx: a trigger, a panel pinned to one edge
 * of the window, the dim behind it, a title and a close button.
 *
 * ```tsx
 * <Drawer.Root model={() => state.open} placement="start">
 *     <Drawer.Trigger><text>Menu</text></Drawer.Trigger>
 *     <Drawer.Panel>
 *         <Drawer.Title>Navigation</Drawer.Title>
 *         …links…
 *         <Drawer.Close><text>Close</text></Drawer.Close>
 *     </Drawer.Panel>
 * </Drawer.Root>
 * ```
 *
 * It is Dialog's machinery with an edge instead of a centre:
 *
 * - **top layer** → the overlay portal (the last child of ZeroRoot's host);
 * - **backdrop** → the anatomy's `::backdrop` PSEUDO part rendered as a real
 *   view that fills the outlet (the whole window), styled by the same
 *   recipe. It opts back into touches under the pass-through outlet layer
 *   (`OVERLAY_ROOT_STYLE`, #1180);
 * - **light dismiss** → a backdrop tap dismisses through the layer stack
 *   (innermost first); the panel catches the bubble with a no-op `catchtap`.
 *   The dismiss layer also consumes a back-button dismissal (reported as
 *   `escape`, the web's name for "the platform's cancel");
 * - **closed means unmounted** — the proven lynx modal idiom.
 *
 * **The edge is stated here, not in the skin.** The web recipe pins the sheet
 * with logical insets and sizes it `100dvh` / `85dvh`; lynx resolves neither
 * logical insets on Android nor viewport units against the outlet. So the
 * backdrop is a flex box that puts the panel on its edge — a row for
 * `start`/`end` (the panel stretches to the full height), a column for
 * `top`/`bottom` (the full width, capped at 85% of the window's height,
 * the recipe's `85dvh`). The panel's width is the skin's cap
 * (`--l-measure`) over an inline `85%` — together the web's
 * `min(20rem, 85vw)` — or `measure` when set. `start` is the LEFT edge:
 * lynx has no RTL flow for it to mirror with.
 *
 * The panel pads its content by the host's safe frame on the edges it
 * touches, so the paper runs under a status bar while the links do not; a
 * rising keyboard lifts the content the same way (#1232). The content is a
 * scroll body: a tall navigation list scrolls inside the panel.
 *
 * `modal={false}` is the INLINE regime: the panel renders in place (no
 * portal, no backdrop, no dismiss layer) while open — `data-l-dock="inline"`.
 *
 * Every close is reported on the `close` event with its reason, after
 * `openChange(false)` — zero's contract: `close` (Drawer.Close), `backdrop`,
 * `escape` (a back-button dismissal) and `programmatic` (a model write).
 *
 * Not carried (web-only or deferred): the root's `label` (lynx cannot name a
 * container without swallowing its children from the reader — a visible or
 * `visuallyHidden` Drawer.Title is the panel's heading), the responsive `modal={{ below }}`
 * regime and `dock-above` (lynx compiles no media queries), swipe-to-dismiss
 * and its `swiping` flag, `initialFocus` / `finalFocus` / `preventScroll`
 * (no document focus or scroll to manage), `escapeKeyDown` /
 * `interactOutside` (no keyboard; the backdrop tap is the only outside).
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide, effect, onUnmounted } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { createControllableState } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';
import { dismissTopLayer, registerDismissLayer } from '../../behaviors/dismiss.js';
import type { OverlayInsets } from '../../behaviors/position.js';
import { createAncestorMotion, useOutletFill, useOutletFullHeight, useOutletRect, useOverlayInsets } from '../../behaviors/position.js';
import { acquireKeyboard, keyboardHeight, keyboardOverlap } from '../../behaviors/keyboard.js';
import { VISUALLY_HIDDEN } from '../../shared/native-text.js';
import { OVERLAY_ROOT_STYLE, PortalScope, useOverlayPortal } from '../../overlay/OverlayHost.js';

const anatomy = anatomies.drawer;

/** The edge the panel sits on: `start`/`end` are the left/right edges on lynx, `top`/`bottom` the block edges. */
export type DrawerPlacement = 'start' | 'end' | 'top' | 'bottom';

/**
 * What closed the drawer: `close` the Drawer.Close part, `backdrop` a tap on
 * the dim, `escape` a back-button dismissal through the layer stack, and
 * `programmatic` every close lynx-zero did not initiate (a model write).
 */
export type DrawerCloseReason = 'close' | 'escape' | 'backdrop' | 'programmatic';

/** The `close` event's detail. */
export interface DrawerCloseDetail {
    reason: DrawerCloseReason;
    /** The closing Drawer.Close's `value`, when it has one. */
    value?: string;
}

/**
 * The panel's width: a pixel cap, or `full` for the whole window. Unset, the
 * skin's own cap applies (daisy: `min(20rem, 85%)`).
 */
export type DrawerMeasure = number | 'full';

interface DrawerContext {
    open(): boolean;
    setOpen(next: boolean): void;
    requestClose(reason: DrawerCloseReason, value?: string): void;
    dismissible(): boolean;
    modal(): boolean;
    placement(): DrawerPlacement;
}

const useDrawerContext = defineInjectable<DrawerContext>(() => ({
    open: () => false,
    setOpen: () => {},
    requestClose: () => {},
    dismissible: () => true,
    modal: () => true,
    placement: () => 'start',
}));

// ── Root ──

export type DrawerRootProps =
    & Define.Model<boolean>
    & Define.Prop<'defaultOpen', boolean, false>
    & Define.Event<'openChange', boolean>
    /** Fires once per close, after `openChange(false)`, with the reason. */
    & Define.Event<'close', DrawerCloseDetail>
    /** `true` (default): a modal sheet in the overlay outlet. `false`: the panel renders in place. */
    & Define.Prop<'modal', boolean, false>
    /** Whether a backdrop tap (or a back-button dismissal) closes the drawer. Default true. */
    & Define.Prop<'dismissible', boolean, false>
    /** The edge: `start` (default, left), `end` (right), `top`, `bottom`. */
    & Define.Prop<'placement', DrawerPlacement, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'variant', string, false>
    & Define.Slot<'default'>;

const DrawerRoot = component<DrawerRootProps>(({ props, slots, emit }) => {
    const state = createControllableState<boolean>(
        () => props.model,
        props.defaultOpen ?? false,
        (value) => emit('openChange', value),
    );
    const axes = (): VariantAxes => resolveVariantAxes(anatomy.scope, { color: props.color, size: props.size, variant: props.variant });
    provideVariantAxes(axes);

    // The reason of the close lynx-zero is making right now; any other
    // open → closed transition is a model write (`programmatic`).
    let pending: DrawerCloseDetail | null = null;
    let wasOpen = state.value;
    const watcher = effect(() => {
        const open = state.value;
        if (wasOpen && !open) emit('close', pending ?? { reason: 'programmatic' });
        pending = null;
        wasOpen = open;
    });
    onUnmounted(() => watcher.stop());

    defineProvide(useDrawerContext, () => ({
        open: () => state.value,
        setOpen: (next) => {
            state.value = next;
        },
        requestClose: (reason, value) => {
            if (!state.value) return;
            pending = value === undefined ? { reason } : { reason, value };
            state.value = false;
            // A controlled model that refused the write: nothing closed.
            if (state.value) pending = null;
        },
        dismissible: () => props.dismissible !== false,
        modal: () => props.modal !== false,
        placement: () => props.placement ?? 'start',
    }));
    // Root renders nothing itself — the trigger sits in flow, the panel
    // portals to the outlet.
    return () => slots.default?.();
}, { name: 'Drawer.Root' });

// ── Trigger ──

export type DrawerTriggerProps =
    & Define.Prop<'disabled', boolean, false>
    /** Accessible name, when the visible content is not text. */
    & Define.Prop<'label', string, false>
    /** `false` turns off the main-thread press feel (the pressed flag stays). */
    & Define.Prop<'pressFeel', boolean, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const DrawerTrigger = component<DrawerTriggerProps>(({ props, slots }) => {
    const drawer = useDrawerContext();
    const axes = useVariantAxes();
    const disabled = (): boolean => !!props.disabled;
    const press = createPressFeedback({ isDisabled: disabled, feel: props.pressFeel !== false });
    return () => {
        const open = drawer.open();
        return (
            <view
                {...partBag(anatomy, 'trigger', {
                    state: open ? 'open' : 'closed',
                    flags: { disabled: disabled(), pressed: press.pressed() },
                    ...partAxes(axes()),
                    class: props.class,
                })}
                {...partA11y({ trait: 'button', label: props.label, expanded: open, disabled: disabled() })}
                bindtap={() => {
                    if (!disabled()) drawer.setOpen(!drawer.open());
                }}
                {...press.handlers}
            >
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'Drawer.Trigger' });

// ── Panel ──

/** The share of the window a block-edge sheet may take (the recipe's `85dvh`). */
export const DRAWER_BLOCK_CAP = 0.85;
/** The share of the window's width a side panel takes before the skin's cap (the recipe's `85vw`). */
export const DRAWER_INLINE_SHARE = 0.85;

/** The drawer's geometry, as inline styles — see `drawerLayout`. */
export interface DrawerLayout {
    /** The backdrop's flex box: puts the panel on its edge. */
    backdrop: Record<string, string | number>;
    /** The panel's box. */
    panel: Record<string, string | number>;
    /** The content's safe-frame (and keyboard) padding. */
    content: Record<string, string>;
}

/**
 * The drawer's geometry, pure (it tests over fake rects). `outletHeight` is
 * 0 while the outlet is unmeasured. `keyboard` is the keyboard's overlap of
 * the outlet (`keyboardOverlap`), already resolved. @internal
 */
export function drawerLayout(
    placement: DrawerPlacement,
    insets: OverlayInsets,
    outletHeight: number,
    keyboard: number,
    measure?: DrawerMeasure,
): DrawerLayout {
    const side = placement === 'start' || placement === 'end';
    const backdrop: Record<string, string | number> = {
        display: 'flex',
        flexDirection: side ? 'row' : 'column',
        alignItems: 'stretch',
        justifyContent: placement === 'start' || placement === 'top' ? 'flex-start' : 'flex-end',
    };
    const panel: Record<string, string | number> = {
        // In flow inside the backdrop's flex box: a skin that pins the sheet
        // `position: fixed` (the web recipe does, with logical insets lynx
        // cannot resolve) would pull it out of the box onto the left edge.
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        // The skin's `margin: 0` for the sheet, restated: a flex child with
        // an auto margin would leave its edge.
        marginTop: '0px', marginRight: '0px', marginBottom: '0px', marginLeft: '0px',
        flexShrink: 0,
    };
    if (side) {
        // The full height by stretch — `auto` over the web recipe's `100dvh`,
        // a viewport unit lynx does not resolve against the outlet. The
        // width a share of the window under the skin's cap, or the measure.
        panel.height = 'auto';
        panel.maxHeight = 'none';
        if (measure === 'full') {
            panel.width = '100%';
            panel.maxWidth = 'none';
        } else if (typeof measure === 'number') {
            panel.width = `${Math.max(0, Math.round(measure))}px`;
            panel.maxWidth = '100%';
        } else {
            panel.width = `${Math.round(DRAWER_INLINE_SHARE * 100)}%`;
        }
    } else {
        // Content-sized up to 85% of the window; full width unless a measure
        // narrows it (centred, as the recipe's auto inline margins do).
        panel.height = 'auto';
        panel.maxHeight = outletHeight > 0
            ? `${Math.round(DRAWER_BLOCK_CAP * outletHeight)}px`
            : `${Math.round(DRAWER_BLOCK_CAP * 100)}%`;
        if (typeof measure === 'number') {
            panel.width = `${Math.max(0, Math.round(measure))}px`;
            panel.maxWidth = '100%';
            panel.alignSelf = 'center';
        } else {
            panel.width = '100%';
            panel.maxWidth = 'none';
        }
    }
    // Pad the content by the safe frame on the edges the panel touches, and
    // by the keyboard's overlap at the bottom when that reaches higher.
    const touches = {
        top: placement !== 'bottom',
        bottom: placement !== 'top',
        left: placement !== 'end',
        right: placement !== 'start',
    };
    const bottom = touches.bottom ? Math.max(insets.bottom, keyboard) : 0;
    const content = {
        paddingTop: `${touches.top ? insets.top : 0}px`,
        paddingRight: `${touches.right ? insets.right : 0}px`,
        paddingBottom: `${bottom}px`,
        paddingLeft: `${touches.left ? insets.left : 0}px`,
    };
    return { backdrop, panel, content };
}

/** When the open-animation fallback bumps fire (ms after opening) — Dialog's. */
const MOTION_FALLBACK_MS = [400, 1000] as const;

/** Room for a focus ring inside the scroll body's clip (#1255) — Dialog's gutter. */
const RING_GUTTER = 4;

/** A side panel's scroll body fills the panel; a block-edge one sizes to its content first. */
function bodyStyle(side: boolean): Record<string, string | number> {
    return {
        flexGrow: side ? 1 : 0,
        flexShrink: 1,
        flexBasis: side ? '0px' : 'auto',
        minHeight: 0,
        marginTop: `-${RING_GUTTER}px`,
        marginRight: `-${RING_GUTTER}px`,
        marginBottom: `-${RING_GUTTER}px`,
        marginLeft: `-${RING_GUTTER}px`,
    };
}

function contentStyle(content: Record<string, string>): Record<string, string> {
    const add = (px: string): string => `${Number.parseFloat(px) + RING_GUTTER}px`;
    return {
        display: 'flex',
        flexDirection: 'column',
        paddingTop: add(content.paddingTop!),
        paddingRight: add(content.paddingRight!),
        paddingBottom: add(content.paddingBottom!),
        paddingLeft: add(content.paddingLeft!),
    };
}

export type DrawerPanelProps =
    /** The panel's width cap: px, or `full`. Unset, the skin's (daisy: 20rem, at most 85% of the window). */
    & Define.Prop<'measure', DrawerMeasure, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const DrawerPanel = component<DrawerPanelProps>(({ props, slots }) => {
    const drawer = useDrawerContext();
    const axes = useVariantAxes();
    const portal = useOverlayPortal();
    const insets = useOverlayInsets();
    const fill = useOutletFill();
    const outlet = useOutletRect();
    const fullHeight = useOutletFullHeight();
    // The slide-in is a transform: anchored popups inside (a Select)
    // re-measure when it ends (#1233).
    const motion = createAncestorMotion();
    const bridge = (): void => {
        defineProvide(useDrawerContext, () => drawer);
        provideVariantAxes(axes);
        motion.provide();
    };
    const layout = (): DrawerLayout => {
        const height = outlet()?.height ?? 0;
        return drawerLayout(
            drawer.placement(),
            insets(),
            height,
            keyboardOverlap(keyboardHeight(), height, fullHeight()),
            props.measure,
        );
    };
    const panelBag = (dock: 'sheet' | 'inline') => partBag(anatomy, 'panel', {
        state: 'open',
        placement: drawer.placement(),
        layout: { dock },
        ...partAxes(axes()),
        class: props.class,
    });
    let motionTimers: ReturnType<typeof setTimeout>[] = [];
    const clearMotionTimers = (): void => {
        for (const t of motionTimers) clearTimeout(t);
        motionTimers = [];
    };
    let releaseKeyboard: (() => void) | null = null;
    // STABLE identities for PortalScope (the Dialog lesson): a fresh render
    // function per closure run would re-render the portaled subtree on every
    // outlet turn.
    const renderSlot = () => slots.default?.();
    let unregister: (() => void) | null = null;
    // A backdrop tap names its reason; a dismissal through the stack that
    // no tap started is the back button's.
    let tapping = false;

    const release = (): void => {
        unregister?.();
        unregister = null;
        releaseKeyboard?.();
        releaseKeyboard = null;
        clearMotionTimers();
    };

    effect(() => {
        if (drawer.open() && drawer.modal()) {
            unregister ??= registerDismissLayer({
                dismiss: () => {
                    if (drawer.dismissible()) drawer.requestClose(tapping ? 'backdrop' : 'escape');
                },
                active: portal.active,
            });
            if (!releaseKeyboard) {
                releaseKeyboard = acquireKeyboard();
                clearMotionTimers();
                motionTimers = MOTION_FALLBACK_MS.map((ms) => setTimeout(() => motion.bump(), ms));
            }
            portal.show(() => {
                const l = layout();
                const side = drawer.placement() === 'start' || drawer.placement() === 'end';
                return (
                    <view
                        {...partBag(anatomy, 'backdrop', { state: 'open', ...partAxes(axes()) })}
                        // The dim fills the outlet — the whole window — and
                        // opts back into touches under the pass-through layer
                        // (#1180); the layer is 0×0, so the fill states its
                        // size (#1190).
                        style={{ ...OVERLAY_ROOT_STYLE, ...fill(), ...l.backdrop }}
                        bindtap={() => {
                            tapping = true;
                            try {
                                dismissTopLayer();
                            } finally {
                                tapping = false;
                            }
                        }}
                    >
                        <view
                            {...panelBag('sheet')}
                            style={l.panel}
                            // The platform's only stopPropagation: an inner
                            // tap must not reach the backdrop's dismiss.
                            catchtap={() => {}}
                            bindanimationend={() => motion.bump()}
                            bindtransitionend={() => motion.bump()}
                        >
                            {/* ALWAYS a scroll body: swapping it in when the
                                keyboard rises would remount the slot. */}
                            <scroll-view scroll-orientation="vertical" scroll-y bounces={false} style={bodyStyle(side)}>
                                <view style={contentStyle(l.content)}>
                                    <PortalScope setup={bridge} render={renderSlot} />
                                </view>
                            </scroll-view>
                        </view>
                    </view>
                );
            });
        } else {
            release();
            portal.hide();
        }
    });
    onUnmounted(release);

    // The inline regime renders in place, while open.
    return () => (drawer.open() && !drawer.modal()
        ? <view {...panelBag('inline')}>{slots.default?.()}</view>
        : undefined);
}, { name: 'Drawer.Panel' });

// ── Title ──

export type DrawerTitleProps =
    /** Keep the title for the reader but out of layout and paint. */
    & Define.Prop<'visuallyHidden', boolean, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const DrawerTitle = component<DrawerTitleProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => {
        const bag = partBag(anatomy, 'title', { ...partAxes(axes()), class: props.class });
        if (props.visuallyHidden) bag['data-visually-hidden'] = '';
        return (
            <text {...bag} {...partA11y({ trait: 'header' })} style={props.visuallyHidden ? VISUALLY_HIDDEN : undefined}>
                {slots.default?.()}
            </text>
        );
    };
}, { name: 'Drawer.Title' });

// ── Close ──

export type DrawerCloseProps =
    /** Reported on the root's `close` event as `value`. */
    & Define.Prop<'value', string, false>
    & Define.Prop<'disabled', boolean, false>
    /** Accessible name (default "Close"). */
    & Define.Prop<'label', string, false>
    & Define.Prop<'pressFeel', boolean, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const DrawerClose = component<DrawerCloseProps>(({ props, slots }) => {
    const drawer = useDrawerContext();
    const axes = useVariantAxes();
    const disabled = (): boolean => !!props.disabled;
    const press = createPressFeedback({ isDisabled: disabled, feel: props.pressFeel !== false });
    return () => (
        <view
            {...partBag(anatomy, 'close', {
                flags: { disabled: disabled(), pressed: press.pressed() },
                ...partAxes(axes()),
                class: props.class,
            })}
            {...partA11y({ trait: 'button', label: props.label ?? 'Close', disabled: disabled() })}
            bindtap={() => {
                if (!disabled()) drawer.requestClose('close', props.value);
            }}
            {...press.handlers}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Drawer.Close' });

export const Drawer = compound(DrawerRoot, {
    Root: DrawerRoot,
    Trigger: DrawerTrigger,
    Panel: DrawerPanel,
    Title: DrawerTitle,
    Close: DrawerClose,
});
