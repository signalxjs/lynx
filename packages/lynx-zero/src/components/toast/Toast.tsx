/**
 * Toast — the persistent overlay: a store (`createToaster`) plus a viewport
 * that portals ONCE and re-asserts the top of the outlet whenever a toast
 * arrives (hide + show — the registry keeps `show` position-stable on
 * purpose, so climbing is an explicit act). Timed dismissal per toast;
 * placement classes on viewport and roots per the anatomy's declared set.
 *
 * Presence is zero's: a toast is created `closed` and flips to `open` a
 * frame later (so the skin's closed→open transition plays), and `dismiss()`
 * flips it back to `closed` and removes it once the exit has had time to
 * play. The parts compose like zero's (`Toast.Root` / `Title` /
 * `Description` / `Action` / `Close`); the viewport renders that stock
 * composition, and the parts also render IN PLACE, outside any viewport —
 * the state-matrix gallery draws its toasts that way.
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide, effect, signal } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { ForcedFlags, VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideForcedFlags, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';
import { PortalScope, useOverlayPortal } from '../../overlay/OverlayHost.js';

const anatomy = anatomies.toast;

export type ToastPlacement = 'top-start' | 'top' | 'top-end' | 'bottom-start' | 'bottom' | 'bottom-end';

/** The stock composition's action button. */
export interface ToastActionData {
    label: string;
    onPress?: () => void;
}

export interface ToastOptions {
    title: string;
    description?: string;
    /** ms until auto-dismiss; 0 disables the timer. Default 4000. */
    duration?: number;
    /** Role color of this toast (the root's `color` axis). */
    color?: string;
    /** An action button, rendered before the close button. */
    action?: ToastActionData;
}

export interface ToastItem extends ToastOptions {
    id: number;
    /** Presence: false while entering (one frame) and while exiting. */
    open: boolean;
}

export interface Toaster {
    /** The mounted toasts, oldest first — entering and exiting ones included. */
    toasts(): ToastItem[];
    show(options: ToastOptions): number;
    /** Begin a toast's exit; it is removed once the exit has played. */
    dismiss(id: number): void;
    /** Drop a toast immediately, no exit. */
    remove(id: number): void;
}

export interface ToasterOptions {
    /** ms a dismissed toast stays mounted, `closed`, for its exit transition. Default 200. */
    exitDuration?: number;
}

/** The delay before a new toast flips `open` — one frame, so its entry transitions. */
const ENTER_DELAY = 16;

let nextToastId = 1;

/** The store — creatable headlessly (an app service can toast). */
export function createToaster(options: ToasterOptions = {}): Toaster {
    const exitDuration = Math.max(0, options.exitDuration ?? 200);
    const state = signal<{ items: ToastItem[] }>({ items: [] });
    // Ids whose exit has begun: they never re-open, and never re-exit.
    const exiting = new Set<number>();
    const setOpen = (id: number, open: boolean): void => {
        state.items = state.items.map((t) => (t.id === id ? { ...t, open } : t));
    };
    const remove = (id: number): void => {
        exiting.delete(id);
        state.items = state.items.filter((t) => t.id !== id);
    };
    const dismiss = (id: number): void => {
        if (exiting.has(id) || !state.items.some((t) => t.id === id)) return;
        exiting.add(id);
        setOpen(id, false);
        if (exitDuration === 0) remove(id);
        else setTimeout(() => remove(id), exitDuration);
    };
    return {
        toasts: () => state.items,
        show(opts) {
            const id = nextToastId++;
            state.items = [...state.items, { ...opts, id, open: false }];
            setTimeout(() => {
                if (!exiting.has(id) && state.items.some((t) => t.id === id)) setOpen(id, true);
            }, ENTER_DELAY);
            const duration = opts.duration ?? 4000;
            if (duration > 0) setTimeout(() => dismiss(id), duration);
            return id;
        },
        dismiss,
        remove,
    };
}

const useToaster = defineInjectable<Toaster>(() => createToaster());

/** Provide a specific toaster to a subtree (else each viewport owns one). */
export function provideToaster(toaster: Toaster): void {
    defineProvide(useToaster, () => toaster);
}

// ── Contexts ──

interface ToastViewportContext {
    placement(): ToastPlacement | undefined;
    size(): string | undefined;
    dismiss(id: number): void;
}

/** Outside a viewport: no placement, and a close just runs `onDismiss`. */
const useToastViewportContext = defineInjectable<ToastViewportContext>(() => ({
    placement: () => undefined,
    size: () => undefined,
    dismiss: () => {},
}));

interface ToastItemContext {
    dismiss(): void;
}

const useToastItemContext = defineInjectable<ToastItemContext>(() => ({ dismiss: () => {} }));

// ── Root ──

export type ToastRootProps =
    /** The toast's data; omit it to compose an always-open toast in place. */
    & Define.Prop<'toast', ToastItem, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    /** Runs on Close, after the toast's own dismissal. */
    & Define.Event<'dismiss'>
    & Define.Slot<'default'>;

const ToastRoot = component<ToastRootProps>(({ props, slots, emit }) => {
    const viewport = useToastViewportContext();
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color ?? props.toast?.color,
        size: props.size ?? viewport.size(),
    }));
    defineProvide(useToastItemContext, () => ({
        dismiss: () => {
            if (props.toast) viewport.dismiss(props.toast.id);
            emit('dismiss');
        },
    }));
    return () => (
        <view
            {...partBag(anatomy, 'root', {
                state: props.toast && !props.toast.open ? 'closed' : 'open',
                placement: viewport.placement(),
                ...partAxes(axes()),
                class: props.class,
            })}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Toast.Root' });

// ── Title / Description ──

type TextPartProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

const ToastTitle = component<TextPartProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <text {...partBag(anatomy, 'title', { ...partAxes(axes()), class: props.class })}>{slots.default?.()}</text>
    );
}, { name: 'Toast.Title' });

const ToastDescription = component<TextPartProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <text {...partBag(anatomy, 'description', { ...partAxes(axes()), class: props.class })}>{slots.default?.()}</text>
    );
}, { name: 'Toast.Description' });

// ── Action / Close ──

export type ToastActionProps =
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'class', string, false>
    /** Accessible name — required when the content is not plain text. */
    & Define.Prop<'label', string, false>
    & Define.Event<'press'>
    & Define.Slot<'default'>;

/**
 * One pressable part. A real component per instance, so each owns its own
 * press feedback (a shared instance would light up EVERY toast's close).
 */
const ToastAction = component<ToastActionProps>(({ props, slots, emit }) => {
    const axes = useVariantAxes();
    const disabled = (): boolean => !!props.disabled;
    const press = createPressFeedback({ isDisabled: disabled });
    return () => (
        <view
            {...partBag(anatomy, 'action', {
                flags: { disabled: disabled(), pressed: press.pressed() },
                ...partAxes(axes()),
                class: props.class,
            })}
            {...partA11y({ trait: 'button', label: props.label, disabled: disabled() })}
            bindtap={() => {
                if (!disabled()) emit('press');
            }}
            {...press.handlers}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Toast.Action' });

export type ToastCloseProps =
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'class', string, false>
    /** Accessible name (default "Dismiss"). */
    & Define.Prop<'label', string, false>
    & Define.Slot<'default'>;

const ToastClose = component<ToastCloseProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    const item = useToastItemContext();
    const disabled = (): boolean => !!props.disabled;
    const press = createPressFeedback({ isDisabled: disabled });
    return () => (
        <view
            {...partBag(anatomy, 'close', {
                flags: { disabled: disabled(), pressed: press.pressed() },
                ...partAxes(axes()),
                class: props.class,
            })}
            {...partA11y({ trait: 'button', label: props.label ?? 'Dismiss', disabled: disabled() })}
            bindtap={() => {
                if (!disabled()) item.dismiss();
            }}
            {...press.handlers}
        >
            {slots.default?.() ?? <text>×</text>}
        </view>
    );
}, { name: 'Toast.Close' });

// ── Viewport ──

type ToastCardProps = Define.Prop<'toast', ToastItem, true>;

/** The stock composition — zero's: title, description, action, close. */
const ToastCard = component<ToastCardProps>(({ props }) => {
    return () => {
        const t = props.toast;
        return (
            <ToastRoot toast={t}>
                <ToastTitle>{t.title}</ToastTitle>
                {t.description ? <ToastDescription>{t.description}</ToastDescription> : null}
                {t.action
                    ? <ToastAction label={t.action.label} onPress={() => t.action?.onPress?.()}><text>{t.action.label}</text></ToastAction>
                    : null}
                <ToastClose />
            </ToastRoot>
        );
    };
}, { name: 'Toast.Card' });

export type ToastViewportProps =
    & Define.Prop<'placement', ToastPlacement, false>
    /** The toasts' `size` axis (every toast in this viewport). */
    & Define.Prop<'size', string, false>
    /** The store to render. Defaults to the injected/ambient one. */
    & Define.Prop<'toaster', Toaster, false>
    & Define.Prop<'class', string, false>;

const ToastViewport = component<ToastViewportProps>(({ props }) => {
    const ambient = useToaster();
    const toaster = () => props.toaster ?? ambient;
    const placement = (): ToastPlacement => props.placement ?? 'bottom';
    const portal = useOverlayPortal();
    // The cards mount under the OUTLET, outside this component's provider
    // chain: carry an enclosing ForceStates across with the portal.
    const outer = useVariantAxes();
    const forced = (): ForcedFlags | undefined => outer().forced;
    const context: ToastViewportContext = {
        placement,
        size: () => props.size,
        dismiss: (id) => toaster().dismiss(id),
    };
    const bridge = (): void => {
        provideForcedFlags(forced);
        defineProvide(useToastViewportContext, () => context);
    };

    // The viewport is a full-width strip pinned to the outlet's top or
    // bottom edge. The skin's web centering (`left: 50%` + a half-width
    // `translateX(-50%)` pull-back) is written for a shrink-wrapped popover;
    // under the inline `left: 0` it shifted this strip half its width off
    // the left edge — the inline `transform: none` cancels it. `display:
    // flex` because a lynx view defaults to linear layout, where the skin's
    // flex-direction/gap never apply. Card alignment is the skin's.
    const edge = (): Record<string, string | number> => {
        const style: Record<string, string | number> = {
            position: 'absolute', left: 0, right: 0, transform: 'none', display: 'flex',
        };
        if (placement().startsWith('top')) style['top'] = 0;
        else style['bottom'] = 0;
        return style;
    };

    // Stable identity (see Dialog): the cards read the store reactively
    // inside the portal, so the outlet re-renders them in place.
    const renderCards = () => toaster().toasts().map((toast) => <ToastCard key={toast.id} toast={toast} />);
    let newest = -1;

    effect(() => {
        const items = toaster().toasts();
        if (items.length === 0) {
            newest = -1;
            portal.hide();
            return;
        }
        // Re-assert the top on every ARRIVAL: a dialog that opened after the
        // viewport must not cover incoming toasts. A presence flip or a
        // removal updates in place — no climb.
        const last = items[items.length - 1]!.id;
        if (last !== newest) {
            newest = last;
            portal.hide();
        }
        portal.show(() => (
            <view {...partBag(anatomy, 'viewport', { placement: placement(), class: props.class })} style={edge()}>
                <PortalScope setup={bridge} render={renderCards} />
            </view>
        ));
    });

    return () => undefined;
}, { name: 'Toast.Viewport' });

export const Toast = compound(ToastViewport, {
    Viewport: ToastViewport,
    Root: ToastRoot,
    Title: ToastTitle,
    Description: ToastDescription,
    Action: ToastAction,
    Close: ToastClose,
});
