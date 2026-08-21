/**
 * Dialog — the first consumer of the overlay stack, composed from what the
 * web's `<dialog>.showModal()` gave for free:
 *
 * - **top layer** → the overlay portal (last child of ZeroRoot's host);
 * - **backdrop** → the anatomy's `::backdrop` PSEUDO part rendered as a REAL
 *   full-surface view (exactly what the anatomy's own docs promise for
 *   platforms without the pseudo-element), styled by the same recipe;
 * - **light dismiss** → the backdrop's own tap dismisses through the layer
 *   stack (innermost-first), while the popup catches the bubble with a
 *   no-op `catchtap` (#260: `catch*` is this platform's only
 *   stopPropagation);
 * - **Escape** → none on this platform; a back-button hook can call
 *   `dismissTopLayer()` later.
 *
 * Closed means UNMOUNTED — the proven lynx modal idiom (a display:none
 * overlay leaks paint on this engine).
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
import { PortalScope, useOverlayPortal } from '../../overlay/OverlayHost.js';

const anatomy = anatomies.dialog;

interface DialogContext {
    open(): boolean;
    setOpen(next: boolean): void;
    dismissible(): boolean;
}

const useDialogContext = defineInjectable<DialogContext>(() => ({
    open: () => false,
    setOpen: () => {},
    dismissible: () => true,
}));

export type DialogRootProps =
    & Define.Model<boolean>
    & Define.Prop<'defaultOpen', boolean, false>
    & Define.Event<'openChange', boolean>
    /** Whether a backdrop tap closes the dialog. Default true. */
    & Define.Prop<'dismissible', boolean, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'variant', string, false>
    & Define.Slot<'default'>;

const DialogRoot = component<DialogRootProps>(({ props, slots, emit }) => {
    const state = createControllableState<boolean>(
        () => props.model,
        props.defaultOpen ?? false,
        (value) => emit('openChange', value),
    );
    const axes = (): VariantAxes => resolveVariantAxes(anatomy.scope, { color: props.color, size: props.size, variant: props.variant });
    provideVariantAxes(axes);
    defineProvide(useDialogContext, () => ({
        open: () => state.value,
        setOpen: (next) => {
            state.value = next;
        },
        dismissible: () => props.dismissible !== false,
    }));
    // Root renders nothing itself — the trigger sits in flow, the popup
    // portals to the outlet.
    return () => slots.default?.();
}, { name: 'Dialog.Root' });

type TriggerProps = Define.Prop<'disabled', boolean, false> & Define.Prop<'class', string, false> & Define.Slot<'default'>;

const DialogTrigger = component<TriggerProps>(({ props, slots }) => {
    const dialog = useDialogContext();
    const axes = useVariantAxes();
    const disabled = () => !!props.disabled;
    const press = createPressFeedback({ isDisabled: disabled });
    return () => (
        <view
            {...partBag(anatomy, 'trigger', {
                state: dialog.open() ? 'open' : 'closed',
                flags: { disabled: disabled(), pressed: press.pressed() },
                ...partAxes(axes()),
                class: props.class,
            })}
            {...partA11y({ trait: 'button', disabled: disabled() })}
            bindtap={() => {
                if (!disabled()) dialog.setOpen(true);
            }}
            {...press.handlers}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Dialog.Trigger' });

type PopupProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

const DialogPopup = component<PopupProps>(({ props, slots }) => {
    const dialog = useDialogContext();
    const axes = useVariantAxes();
    const portal = useOverlayPortal();
    // Slot content mounts under the OUTLET — re-provide what it needs.
    const bridge = () => {
        defineProvide(useDialogContext, () => dialog);
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
        if (dialog.open()) {
            // The layer CONSUMES every dismiss request (a back button must
            // not navigate while a modal is up) — but the dialog decides
            // whether consuming means closing.
            unregister ??= registerDismissLayer({
                dismiss: () => {
                    if (dialog.dismissible()) dialog.setOpen(false);
                },
            });
            portal.show(() => (
                <view
                    {...partBag(anatomy, 'backdrop', { state: 'open', ...partAxes(axes()) })}
                    // Centering is stated here because on the web it comes from
                    // the native <dialog>'s UA `margin: auto` — a behavior the
                    // recipe never spells, so the compiled skin carries no
                    // centering and the panel would pin to the top (#1080).
                    style={{
                        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    }}
                    // Route through the stack, not straight to setOpen: the
                    // innermost layer owns the gesture (dismiss.ts's contract).
                    bindtap={() => dismissTopLayer()}
                >
                    <view
                        {...partBag(anatomy, 'popup', { state: 'open', ...partAxes(axes()), class: props.class })}
                        // The platform's only stopPropagation: an inner tap
                        // must not reach the backdrop's dismiss.
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
}, { name: 'Dialog.Popup' });

type PartProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

const DialogTitle = component<PartProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <text {...partBag(anatomy, 'title', { ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </text>
    );
}, { name: 'Dialog.Title' });

const DialogDescription = component<PartProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <text {...partBag(anatomy, 'description', { ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </text>
    );
}, { name: 'Dialog.Description' });

const DialogFooter = component<PartProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <view {...partBag(anatomy, 'footer', { ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </view>
    );
}, { name: 'Dialog.Footer' });

const DialogClose = component<PartProps>(({ props, slots }) => {
    const dialog = useDialogContext();
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
            bindtap={() => dialog.setOpen(false)}
            {...press.handlers}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Dialog.Close' });

export const Dialog = compound(DialogRoot, {
    Root: DialogRoot,
    Trigger: DialogTrigger,
    Popup: DialogPopup,
    Title: DialogTitle,
    Description: DialogDescription,
    Footer: DialogFooter,
    Close: DialogClose,
});
