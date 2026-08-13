/**
 * Popover — the anchored overlay: the trigger measures itself
 * (`bindlayoutchange`, page-relative), the popup portals to the outlet and
 * positions absolutely from the shared placement math, and the RESOLVED
 * side (after flipping) stamps through `partBag` as the placement class +
 * `data-placement` — exactly what the web behavior writes.
 *
 * Light dismiss is a TRANSPARENT full-surface backdrop behind the popup:
 * this platform has no document-level outside-press listener, so the
 * overlay owns its own outside surface; the popup catches the bubble.
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide, effect, onUnmounted } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { createControllableState } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { createPressFeedback } from '../../behaviors/press.js';
import { dismissTopLayer, registerDismissLayer } from '../../behaviors/dismiss.js';
import type { LynxAnchorPosition, LynxPlacement } from '../../behaviors/position.js';
import { createAnchorPosition } from '../../behaviors/position.js';
import { PortalScope, useOverlayPortal } from '../../overlay/OverlayHost.js';

const anatomy = anatomies.popover;

interface PopoverContext {
    open(): boolean;
    setOpen(next: boolean): void;
    position: LynxAnchorPosition;
    placement(): LynxPlacement;
}

const usePopoverContext = defineInjectable<PopoverContext | null>(() => null);

export type PopoverRootProps =
    & Define.Model<boolean>
    & Define.Prop<'defaultOpen', boolean, false>
    & Define.Event<'openChange', boolean>
    & Define.Prop<'placement', LynxPlacement, false>
    & Define.Prop<'offset', number, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'variant', string, false>
    & Define.Slot<'default'>;

const PopoverRoot = component<PopoverRootProps>(({ props, slots, emit }) => {
    const state = createControllableState<boolean>(
        () => props.model,
        props.defaultOpen ?? false,
        (value) => emit('openChange', value),
    );
    const axes = (): VariantAxes => ({ color: props.color, size: props.size, variant: props.variant });
    provideVariantAxes(axes);
    const position = createAnchorPosition({
        placement: props.placement ?? 'bottom',
        offset: props.offset,
    });
    defineProvide(usePopoverContext, () => ({
        open: () => state.value,
        setOpen: (next) => {
            state.value = next;
        },
        position,
        placement: () => position.position()?.placement ?? props.placement ?? 'bottom',
    }));
    return () => slots.default?.();
}, { name: 'Popover.Root' });

type TriggerProps = Define.Prop<'disabled', boolean, false> & Define.Prop<'class', string, false> & Define.Slot<'default'>;

const PopoverTrigger = component<TriggerProps>(({ props, slots }) => {
    const popover = usePopoverContext();
    const axes = useVariantAxes();
    const disabled = () => !!props.disabled;
    const press = createPressFeedback({ isDisabled: disabled });
    return () => (
        <view
            {...partBag(anatomy, 'trigger', {
                state: popover?.open() ? 'open' : 'closed',
                flags: { disabled: disabled(), pressed: press.pressed() },
                ...partAxes(axes()),
                class: props.class,
            })}
            {...partA11y({ trait: 'button', disabled: disabled() })}
            bindtap={() => {
                if (!disabled() && popover) popover.setOpen(!popover.open());
            }}
            bindlayoutchange={popover?.position.anchorLayoutChange}
            {...press.handlers}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Popover.Trigger' });

type PopupProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

const PopoverPopup = component<PopupProps>(({ props, slots }) => {
    const popover = usePopoverContext();
    const axes = useVariantAxes();
    const portal = useOverlayPortal();
    const bridge = () => {
        defineProvide(usePopoverContext, () => popover);
        provideVariantAxes(axes);
    };
    // STABLE identities for everything the portal closure hands to
    // PortalScope: a fresh arrow per closure run would re-render the portaled
    // subtree on every outlet turn, and a remounting overlay inside it then
    // mints a new portal entry per turn — a microtask cascade that starves
    // the event loop (found by the nested dialog+popover test).
    const renderSlot = () => slots.default?.();
    let unregister: (() => void) | null = null;

    effect(() => {
        if (popover?.open()) {
            unregister ??= registerDismissLayer({ dismiss: () => popover.setOpen(false) });
            portal.show(() => (
                <view
                    // The transparent outside surface — light dismiss lives
                    // on the overlay itself on this platform, and it routes
                    // through the stack so the INNERMOST layer owns the
                    // gesture (dismiss.ts's contract).
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                    bindtap={() => dismissTopLayer()}
                >
                    <view
                        {...partBag(anatomy, 'popup', {
                            state: 'open',
                            placement: popover.placement(),
                            ...partAxes(axes()),
                            class: props.class,
                        })}
                        style={popover.position.style()}
                        bindlayoutchange={popover.position.floatingLayoutChange}
                        catchtap={() => {}}
                    >
                        <PortalScope setup={bridge} render={renderSlot} />
                    </view>
                </view>
            ));
        } else {
            unregister?.();
            unregister = null;
            portal.hide();
        }
    });
    onUnmounted(() => unregister?.());

    return () => undefined;
}, { name: 'Popover.Popup' });

type PartProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

const PopoverTitle = component<PartProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <text {...partBag(anatomy, 'title', { ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </text>
    );
}, { name: 'Popover.Title' });

const PopoverClose = component<PartProps>(({ props, slots }) => {
    const popover = usePopoverContext();
    const axes = useVariantAxes();
    const press = createPressFeedback();
    return () => (
        <view
            {...partBag(anatomy, 'close', {
                flags: { pressed: press.pressed() },
                ...partAxes(axes()),
                class: props.class,
            })}
            {...partA11y({ trait: 'button', label: 'Close' })}
            bindtap={() => popover?.setOpen(false)}
            {...press.handlers}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Popover.Close' });

export const Popover = compound(PopoverRoot, {
    Root: PopoverRoot,
    Trigger: PopoverTrigger,
    Popup: PopoverPopup,
    Title: PopoverTitle,
    Close: PopoverClose,
});
