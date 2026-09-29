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
 * - **Escape** → the Android back button: the dismiss stack's back
 *   interceptor closes the innermost layer before navigation pops (#1290).
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
import { createAncestorMotion, useOutletFill, useOutletFullHeight, useOutletRect, useOverlayInsets } from '../../behaviors/position.js';
import { acquireKeyboard, keyboardHeight, keyboardOverlap } from '../../behaviors/keyboard.js';
import { OVERLAY_ROOT_STYLE, PortalScope, useOverlayPortal } from '../../overlay/OverlayHost.js';

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

/** When the open-animation fallback bumps fire (ms after opening). */
const MOTION_FALLBACK_MS = [300, 1000] as const;

/** The space kept between the panel and the visible box's edges, per side (px). */
const DIALOG_MARGIN = 16;

/** The panel's vertical box: the backdrop's top/bottom padding and the panel's cap. */
export interface DialogLayout {
    /** Backdrop top padding (px). */
    top: number;
    /** Backdrop bottom padding (px): the safe frame's, or the keyboard's overlap when higher. */
    bottom: number;
    /** The panel's max height (px), or null while the outlet is unmeasured. */
    maxHeight: number | null;
}

/**
 * The dialog panel's vertical box (#1232), pure. The backdrop pads by the
 * safe frame; with the keyboard up it pads its bottom by the keyboard's
 * overlap instead when that reaches higher (never both: the safe frame's
 * bottom inset lies under the keyboard). The panel is capped at what is left,
 * less a margin each side, so a tall one scrolls inside instead of running
 * under the keyboard. See `keyboardOverlap` for `fullHeight`.
 * @internal
 */
export function dialogLayout(
    insets: { top: number; bottom: number },
    outletHeight: number,
    fullHeight: number,
    keyboard: number,
): DialogLayout {
    const bottom = Math.max(insets.bottom, keyboardOverlap(keyboard, outletHeight, fullHeight));
    const maxHeight = outletHeight > 0
        ? Math.max(0, Math.round(outletHeight - insets.top - bottom - 2 * DIALOG_MARGIN))
        : null;
    return { top: insets.top, bottom, maxHeight };
}

function popupStyle(layout: DialogLayout): Record<string, string | number> {
    const style: Record<string, string | number> = { display: 'flex', flexDirection: 'column' };
    if (layout.maxHeight !== null) style.maxHeight = `${layout.maxHeight}px`;
    return style;
}

/**
 * The panel's scroll body: its content's height, shrinking below it (and
 * scrolling) once the panel hits its cap. `flexBasis: auto` sizes it to the
 * content first; `minHeight: 0` is what lets it shrink in the column.
 */
const DIALOG_BODY_STYLE = { flexGrow: 0, flexShrink: 1, flexBasis: 'auto', minHeight: 0 } as const;

/**
 * Room for a focus ring (#1255). A scroll-view clips its children to its
 * bounds, and a focused field's ring is a box-shadow painted OUTSIDE the
 * field — the widest in the skin is 4px (`0 0 0 2px surface, 0 0 0 4px
 * accent`). So the body reaches that far into the panel's own padding
 * (negative margin) and gives it back to the content (padding): the content
 * box lands where it always did, and the ring now paints inside the clip.
 * The panel's padding (24px) is far wider than the gutter.
 */
const DIALOG_RING_GUTTER = 4;

const DIALOG_BODY_OUTSET_STYLE = {
    ...DIALOG_BODY_STYLE,
    marginTop: `-${DIALOG_RING_GUTTER}px`,
    marginRight: `-${DIALOG_RING_GUTTER}px`,
    marginBottom: `-${DIALOG_RING_GUTTER}px`,
    marginLeft: `-${DIALOG_RING_GUTTER}px`,
} as const;

/** The scroll content: the slot, inset by the ring gutter, stacked as before. */
const DIALOG_BODY_CONTENT_STYLE = {
    display: 'flex',
    flexDirection: 'column',
    paddingTop: `${DIALOG_RING_GUTTER}px`,
    paddingRight: `${DIALOG_RING_GUTTER}px`,
    paddingBottom: `${DIALOG_RING_GUTTER}px`,
    paddingLeft: `${DIALOG_RING_GUTTER}px`,
} as const;

const DialogPopup = component<PopupProps>(({ props, slots }) => {
    const dialog = useDialogContext();
    const axes = useVariantAxes();
    const portal = useOverlayPortal();
    const insets = useOverlayInsets();
    const fill = useOutletFill();
    const outlet = useOutletRect();
    const fullHeight = useOutletFullHeight();
    // The panel's open animation is a transform: anchored popups inside it
    // (a Select) re-measure when it ends (#1233).
    const motion = createAncestorMotion();
    // Slot content mounts under the OUTLET — re-provide what it needs.
    const bridge = () => {
        defineProvide(useDialogContext, () => dialog);
        provideVariantAxes(axes);
        motion.provide();
    };
    // The panel's box (#1232). The keyboard covers the bottom of the window;
    // the backdrop pads by whichever reaches higher, the safe frame or the
    // keyboard, so the panel centres in what is still visible — and a panel
    // taller than that scrolls inside instead of running under the keyboard.
    const layout = (): DialogLayout => dialogLayout(insets(), outlet()?.height ?? 0, fullHeight(), keyboardHeight());
    // Fallback for the motion bump: an engine that sends no animation or
    // transition event still re-measures once the open animation must be
    // over. Two bounded bumps per open, cleared on close.
    let motionTimers: ReturnType<typeof setTimeout>[] = [];
    const clearMotionTimers = (): void => {
        for (const t of motionTimers) clearTimeout(t);
        motionTimers = [];
    };
    let releaseKeyboard: (() => void) | null = null;
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
            if (!releaseKeyboard) {
                releaseKeyboard = acquireKeyboard();
                clearMotionTimers();
                motionTimers = MOTION_FALLBACK_MS.map((ms) => setTimeout(() => motion.bump(), ms));
            }
            portal.show(() => (
                <view
                    {...partBag(anatomy, 'backdrop', { state: 'open', ...partAxes(axes()) })}
                    // Centering is stated here because on the web it comes from
                    // the native <dialog>'s UA `margin: auto` — a behavior the
                    // recipe never spells, so the compiled skin carries no
                    // centering and the panel would pin to the top (#1080).
                    //
                    // The backdrop fills the outlet — the whole window (#1169)
                    // — and pads itself by the host's safe frame, so the dim
                    // reaches every edge while the panel centers in the
                    // content box (never under a status bar or a header).
                    // It opts back into touches under the pass-through
                    // outlet layer (#1180) — the panel and the dim both. The
                    // layer is 0×0, so the fill states the window's size
                    // (#1190); a modal backdrop DOES hold native pans.
                    style={{
                        ...OVERLAY_ROOT_STYLE,
                        ...fill(),
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        paddingTop: `${layout().top}px`, paddingRight: `${insets().right}px`,
                        paddingBottom: `${layout().bottom}px`, paddingLeft: `${insets().left}px`,
                    }}
                    // Route through the stack, not straight to setOpen: the
                    // innermost layer owns the gesture (dismiss.ts's contract).
                    bindtap={() => dismissTopLayer()}
                >
                    <view
                        {...partBag(anatomy, 'popup', { state: 'open', ...partAxes(axes()), class: props.class })}
                        // A column capped at the visible box, so the body
                        // below can shrink and scroll (#1232). The skin's
                        // padding stays on the panel (it is border-box).
                        style={popupStyle(layout())}
                        // The platform's only stopPropagation: an inner tap
                        // must not reach the backdrop's dismiss.
                        catchtap={() => {}}
                        // The open animation ended: anchored popups inside
                        // re-measure (#1233).
                        bindanimationend={() => motion.bump()}
                        bindtransitionend={() => motion.bump()}
                    >
                        {/* ALWAYS a scroll body, keyboard or not: swapping
                            the wrapper in when the keyboard rises would
                            remount the slot and drop the focused field. */}
                        <scroll-view
                            scroll-orientation="vertical"
                            scroll-y
                            bounces={false}
                            style={DIALOG_BODY_OUTSET_STYLE}
                        >
                            {/* The ring gutter lives INSIDE the scroll
                                content, so a focused field's ring clears the
                                clip on every side (#1255). */}
                            <view style={DIALOG_BODY_CONTENT_STYLE}>
                                <PortalScope setup={bridge} render={renderSlot} />
                            </view>
                        </scroll-view>
                    </view>
                </view>
            ));
        } else {
            unregister?.();
            unregister = null;
            releaseKeyboard?.();
            releaseKeyboard = null;
            clearMotionTimers();
            portal.hide();
        }
    });
    onUnmounted(() => {
        unregister?.();
        releaseKeyboard?.();
        releaseKeyboard = null;
        clearMotionTimers();
    });

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

type ActionProps =
    & Define.Prop<'disabled', boolean, false>
    /** Accessible name (default "Close" / "Cancel"). */
    & Define.Prop<'label', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

/** Close and Cancel share the behavior; the part (and its default name) differs. */
function dialogAction(part: 'close' | 'cancel', fallbackLabel: string, name: string) {
    return component<ActionProps>(({ props, slots }) => {
        const dialog = useDialogContext();
        const axes = useVariantAxes();
        const disabled = () => !!props.disabled;
        const press = createPressFeedback({ isDisabled: disabled });
        return () => (
            <view
                {...partBag(anatomy, part, {
                    flags: { disabled: disabled(), pressed: press.pressed() },
                    ...partAxes(axes()),
                    class: props.class,
                })}
                {...partA11y({ trait: 'button', label: props.label ?? fallbackLabel, disabled: disabled() })}
                bindtap={() => {
                    if (!disabled()) dialog.setOpen(false);
                }}
                {...press.handlers}
            >
                {slots.default?.()}
            </view>
        );
    }, { name });
}

const DialogClose = dialogAction('close', 'Close', 'Dialog.Close');

/**
 * The least-destructive action of an alert-style dialog — behaviorally a
 * close button, a distinct part so the skin can style it as the quiet member
 * of the pair (zero's `cancel`).
 */
const DialogCancel = dialogAction('cancel', 'Cancel', 'Dialog.Cancel');

export const Dialog = compound(DialogRoot, {
    Root: DialogRoot,
    Trigger: DialogTrigger,
    Popup: DialogPopup,
    Title: DialogTitle,
    Description: DialogDescription,
    Footer: DialogFooter,
    Close: DialogClose,
    Cancel: DialogCancel,
});
