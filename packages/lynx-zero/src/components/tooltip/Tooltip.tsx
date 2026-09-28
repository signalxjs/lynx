/**
 * Tooltip — zero's short label on lynx: a trigger, and a popup anchored to
 * it that opens on a LONG PRESS.
 *
 * ```tsx
 * <Tooltip.Root placement="top">
 *     <Tooltip.Trigger label="Save"><text>💾</text></Tooltip.Trigger>
 *     <Tooltip.Popup>
 *         <text>Save the document</text>
 *         <Tooltip.Arrow />
 *     </Tooltip.Popup>
 * </Tooltip.Root>
 * ```
 *
 * The popup is Popover's machinery: the trigger measures itself, the popup
 * portals to the overlay outlet and positions from the shared placement
 * math (the RESOLVED side stamps as `data-placement`), its root opts back
 * into touches (`OVERLAY_ROOT_STYLE`), and the settle loop measures only
 * while the popup is open.
 *
 * What the platform changes:
 * - **No hover, no keyboard focus.** A touch screen's "hover" is the long
 *   press — the platform tooltip gesture (Android's `tooltipText`, iOS's
 *   context previews). A hold on the trigger opens the popup; lifting the
 *   finger starts `closeDelay` (default 1500 ms), and the popup closes.
 *   A plain TAP is left to the trigger's own content (a Button inside it
 *   still presses).
 * - **No light dismiss surface.** Like the web's `popover="manual"`, a tap
 *   elsewhere is the page's: the tooltip never swallows it, it times out
 *   instead. A tap ON the popup closes it at once.
 * - **The arrow is placed here.** The web strategy writes `--arrow-x` /
 *   `--arrow-y` and the recipe picks the edge from the popup's placement;
 *   lynx CSS has neither a descendant selector nor dependable inline
 *   custom properties, so Tooltip.Arrow states its own geometry (an 8px
 *   square turned 45°, centred on the popup edge that faces the anchor, at
 *   the anchor's centre). The skin paints it.
 *
 * Not carried: `Tooltip.Group` (its delay-sharing is hover choreography),
 * `openDelay` (the platform's long-press duration is the delay), the
 * `aria-describedby` link (lynx has no relationship attributes — give the
 * trigger a `label`).
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
import type { ArrowOffset, LynxAnchorPosition, LynxPlacement } from '../../behaviors/position.js';
import { createAnchorPosition } from '../../behaviors/position.js';
import { OVERLAY_ROOT_STYLE, PortalScope, useOverlayPortal } from '../../overlay/OverlayHost.js';

const anatomy = anatomies.tooltip;

/** Default time the popup stays up after the finger lifts (ms). */
export const TOOLTIP_CLOSE_DELAY = 1500;

/** Default gap between the trigger and the popup (px): room for the arrow. */
const TOOLTIP_OFFSET = 8;

interface TooltipContext {
    open(): boolean;
    /** Open now, cancelling a pending close. */
    show(): void;
    /** Close after `closeDelay`. */
    hideSoon(): void;
    /** Close now. */
    hide(): void;
    position: LynxAnchorPosition;
    placement(): LynxPlacement;
}

const useTooltipContext = defineInjectable<TooltipContext | null>(() => null);

// ── Root ──

export type TooltipRootProps =
    & Define.Model<boolean>
    & Define.Prop<'defaultOpen', boolean, false>
    & Define.Event<'openChange', boolean>
    /** How long the popup stays after the finger lifts (ms). Default 1500. */
    & Define.Prop<'closeDelay', number, false>
    /** The preferred side (default `top`); it flips when that side has no room. */
    & Define.Prop<'placement', LynxPlacement, false>
    /** Gap between the trigger and the popup (px). Default 8. */
    & Define.Prop<'offset', number, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'variant', string, false>
    & Define.Slot<'default'>;

const TooltipRoot = component<TooltipRootProps>(({ props, slots, emit }) => {
    const state = createControllableState<boolean>(
        () => props.model,
        props.defaultOpen ?? false,
        (value) => emit('openChange', value),
    );
    provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, { color: props.color, size: props.size, variant: props.variant }));
    const position = createAnchorPosition({
        placement: props.placement ?? 'top',
        offset: props.offset ?? TOOLTIP_OFFSET,
        isOpen: () => state.value,
    });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cancel = (): void => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
    };
    onUnmounted(cancel);
    const ctx: TooltipContext = {
        open: () => state.value,
        show: () => {
            cancel();
            state.value = true;
        },
        hideSoon: () => {
            cancel();
            if (!state.value) return;
            timer = setTimeout(() => {
                timer = null;
                state.value = false;
            }, props.closeDelay ?? TOOLTIP_CLOSE_DELAY);
        },
        hide: () => {
            cancel();
            state.value = false;
        },
        position,
        placement: () => position.position()?.placement ?? props.placement ?? 'top',
    };
    defineProvide(useTooltipContext, () => ctx);
    return () => slots.default?.();
}, { name: 'Tooltip.Root' });

// ── Trigger ──

export type TooltipTriggerProps =
    /** A disabled trigger never opens its tooltip. */
    & Define.Prop<'disabled', boolean, false>
    /** Accessible name — the reader cannot reach the popup's text from the trigger. */
    & Define.Prop<'label', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const TooltipTrigger = component<TooltipTriggerProps>(({ props, slots }) => {
    const tooltip = useTooltipContext();
    const axes = useVariantAxes();
    const disabled = (): boolean => !!props.disabled;
    // Only a tooltip the long press opened times out on release: one the app
    // opened (the model, `defaultOpen`) stays until the app closes it.
    let held = false;
    const release = (): void => {
        if (!held) return;
        held = false;
        tooltip?.hideSoon();
    };
    return () => (
        <view
            {...partBag(anatomy, 'trigger', {
                state: tooltip?.open() ? 'open' : 'closed',
                flags: { disabled: disabled() },
                ...partAxes(axes()),
                class: props.class,
            })}
            {...partA11y({ label: props.label, disabled: disabled() })}
            bindlongpress={() => {
                if (disabled() || !tooltip) return;
                held = true;
                tooltip.show();
            }}
            bindtouchend={release}
            bindtouchcancel={release}
            main-thread:ref={tooltip?.position.anchorRef}
            bindlayoutchange={tooltip?.position.anchorLayoutChange}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Tooltip.Trigger' });

// ── Popup ──

export type TooltipPopupProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

const TooltipPopup = component<TooltipPopupProps>(({ props, slots }) => {
    const tooltip = useTooltipContext();
    const axes = useVariantAxes();
    const portal = useOverlayPortal();
    const bridge = (): void => {
        defineProvide(useTooltipContext, () => tooltip);
        provideVariantAxes(axes);
    };
    // A stable render function for PortalScope (the Popover lesson): a fresh
    // one per closure run would re-render the portaled subtree every turn.
    const renderSlot = () => slots.default?.();

    effect(() => {
        if (tooltip?.open()) {
            portal.show(() => (
                // A 0×0 root at the outlet's origin: it covers nothing, so the
                // page keeps every touch beside the popup (#1190).
                <view style={{ ...OVERLAY_ROOT_STYLE, position: 'absolute', top: 0, left: 0, width: 0, height: 0, overflow: 'visible' }}>
                    <view
                        {...partBag(anatomy, 'popup', {
                            state: 'open',
                            placement: tooltip.placement(),
                            ...partAxes(axes()),
                            class: props.class,
                        })}
                        // `overflow: visible`: the arrow sits half outside.
                        style={{ ...tooltip.position.style(), overflow: 'visible' }}
                        main-thread:ref={tooltip.position.floatingRef}
                        bindlayoutchange={tooltip.position.floatingLayoutChange}
                        bindtap={() => tooltip.hide()}
                    >
                        <PortalScope setup={bridge} render={renderSlot} />
                    </view>
                </view>
            ));
        } else {
            portal.hide();
        }
    });

    return () => undefined;
}, { name: 'Tooltip.Popup' });

// ── Arrow ──

/** The arrow's box (px): a square turned 45°, half of it outside the popup. */
export const TOOLTIP_ARROW_SIZE = 8;

/**
 * The arrow's inline geometry, pure: on the popup edge facing the anchor, at
 * `offset` along it. Hidden until the offset is known. @internal
 */
export function arrowStyle(placement: LynxPlacement, offset: ArrowOffset | null): Record<string, string | number> {
    const half = TOOLTIP_ARROW_SIZE / 2;
    const style: Record<string, string | number> = {
        position: 'absolute',
        width: `${TOOLTIP_ARROW_SIZE}px`,
        height: `${TOOLTIP_ARROW_SIZE}px`,
        transform: 'rotate(45deg)',
    };
    const side = placement.split('-')[0];
    // The popup is on `side` of the anchor, so the arrow is on its far edge.
    const edge = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[side] ?? 'bottom';
    style[edge] = `-${half}px`;
    const along = side === 'top' || side === 'bottom' ? offset?.x : offset?.y;
    if (along === undefined) {
        style.opacity = 0;
        return style;
    }
    style[side === 'top' || side === 'bottom' ? 'left' : 'top'] = `${along - half}px`;
    return style;
}

export type TooltipArrowProps = Define.Prop<'class', string, false>;

const TooltipArrow = component<TooltipArrowProps>(({ props }) => {
    const tooltip = useTooltipContext();
    const axes = useVariantAxes();
    return () => (
        <view
            {...partBag(anatomy, 'arrow', { ...partAxes(axes()), class: props.class })}
            style={arrowStyle(tooltip?.placement() ?? 'top', tooltip?.position.arrow() ?? null)}
        />
    );
}, { name: 'Tooltip.Arrow' });

export const Tooltip = compound(TooltipRoot, {
    Root: TooltipRoot,
    Trigger: TooltipTrigger,
    Popup: TooltipPopup,
    Arrow: TooltipArrow,
});
