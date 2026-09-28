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
 * play. The parts compose like zero's (`Toast.Root` / `Indicator` / `Title` /
 * `Description` / `Action` / `Close`); the viewport renders that stock
 * composition, and the parts also render IN PLACE, outside any viewport —
 * the state-matrix gallery draws its toasts that way.
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide, effect, onMounted, onUnmounted, signal } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { ForcedFlags, VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideForcedFlags, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';
import { useOutletRect, useOverlayInsets } from '../../behaviors/position.js';
import { OVERLAY_ROOT_STYLE, PortalScope, useOverlayPortal } from '../../overlay/OverlayHost.js';

const anatomy = anatomies.toast;

export type ToastPlacement = 'top-start' | 'top' | 'top-end' | 'bottom-start' | 'bottom' | 'bottom-end';

/** The stock composition's action button. */
export interface ToastActionData {
    label: string;
    onPress?: () => void;
}

/**
 * Where a toast's work stands — drawn by `Toast.Indicator`.
 * `toaster.promise()` drives it (`loading`, then `complete` or `error`); a
 * plain toast has none, and its indicator renders nothing.
 */
export type ToastStatus = 'loading' | 'complete' | 'error';

export interface ToastOptions {
    title: string;
    description?: string;
    /** ms until auto-dismiss; 0 disables the timer. Default 4000. */
    duration?: number;
    /** Role color of this toast (the root's `color` axis). */
    color?: string;
    /** An action button, rendered before the close button. */
    action?: ToastActionData;
    /** Work status, drawn by `Toast.Indicator`; `toaster.promise()` sets it for you. */
    status?: ToastStatus;
}

/**
 * One stage of a promise toast: a title alone, or the options of an
 * ordinary toast (its `status` is the promise's to set).
 */
export type ToastInput = string | Omit<ToastOptions, 'status'>;

export interface ToastPromiseOptions<T> {
    /** Shown while the promise is pending — sticky, with `status: 'loading'`. */
    loading: ToastInput;
    /**
     * Replaces the loading content when the promise resolves
     * (`status: 'complete'`). A mapper that throws settles the error stage.
     */
    success: ToastInput | ((value: T) => ToastInput);
    /** Replaces the loading content when the promise rejects (`status: 'error'`). */
    error: ToastInput | ((error: unknown) => ToastInput);
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
    /**
     * Patch a mounted toast in place (title, description, color, action,
     * status, duration). A new `duration` re-arms its timer from now; 0
     * makes it sticky.
     */
    update(id: number, patch: Partial<ToastOptions>): void;
    /**
     * One toast for the life of a promise: `loading` while it is pending
     * (sticky), then updated in place with `success` or `error` and the
     * default duration restored (unless that stage sets its own). Returns
     * the toast's id; a rejection is handled here, never left unhandled.
     */
    promise<T>(promise: PromiseLike<T>, options: ToastPromiseOptions<T>): number;
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

/** A toast's auto-dismiss when its options name none, in ms. */
const DEFAULT_DURATION = 4000;

let nextToastId = 1;

/** The store — creatable headlessly (an app service can toast). */
export function createToaster(options: ToasterOptions = {}): Toaster {
    const exitDuration = Math.max(0, options.exitDuration ?? 200);
    const state = signal<{ items: ToastItem[] }>({ items: [] });
    // Ids whose exit has begun: they never re-open, and never re-exit.
    const exiting = new Set<number>();
    // Each toast's pending auto-dismiss, so `update` can re-arm it.
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    const disarm = (id: number): void => {
        const timer = timers.get(id);
        if (timer !== undefined) clearTimeout(timer);
        timers.delete(id);
    };
    const has = (id: number): boolean => state.items.some((t) => t.id === id);
    const patch = (id: number, next: Partial<ToastItem>): void => {
        state.items = state.items.map((t) => (t.id === id ? { ...t, ...next } : t));
    };
    const remove = (id: number): void => {
        disarm(id);
        exiting.delete(id);
        state.items = state.items.filter((t) => t.id !== id);
    };
    const dismiss = (id: number): void => {
        if (exiting.has(id) || !has(id)) return;
        disarm(id);
        exiting.add(id);
        patch(id, { open: false });
        if (exitDuration === 0) remove(id);
        else setTimeout(() => remove(id), exitDuration);
    };
    const arm = (id: number, duration: number): void => {
        disarm(id);
        if (duration > 0) timers.set(id, setTimeout(() => dismiss(id), duration));
    };
    const show = (opts: ToastOptions): number => {
        const id = nextToastId++;
        state.items = [...state.items, { ...opts, id, open: false }];
        setTimeout(() => {
            if (!exiting.has(id) && has(id)) patch(id, { open: true });
        }, ENTER_DELAY);
        arm(id, opts.duration ?? DEFAULT_DURATION);
        return id;
    };
    const update = (id: number, next: Partial<ToastOptions>): void => {
        if (exiting.has(id) || !has(id)) return;
        // Only the keys the patch carries: an absent key keeps its value.
        const defined = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
        patch(id, defined);
        if (next.duration !== undefined) arm(id, next.duration);
    };
    const stage = (input: ToastInput): Omit<ToastOptions, 'status'> =>
        typeof input === 'string' ? { title: input } : input;
    const promise = <T,>(pending: PromiseLike<T>, opts: ToastPromiseOptions<T>): number => {
        const id = show({ ...stage(opts.loading), status: 'loading', duration: 0 });
        const settle = (status: ToastStatus, input: Partial<Omit<ToastOptions, 'status'>>): void => {
            // Gone before it settled (dismissed): nothing to update.
            update(id, { ...input, duration: input.duration ?? DEFAULT_DURATION, status });
        };
        // The stage mappers are user code: one that throws must not turn the
        // handled rejection back into an unhandled one.
        const fail = (reason: unknown): void => {
            let input: Partial<Omit<ToastOptions, 'status'>> = {};
            try {
                input = stage(typeof opts.error === 'function' ? opts.error(reason) : opts.error);
            } catch {
                // Nothing to map: the status alone moves to error.
            }
            settle('error', input);
        };
        pending.then(
            (value) => {
                let input: Omit<ToastOptions, 'status'>;
                try {
                    input = stage(typeof opts.success === 'function' ? opts.success(value) : opts.success);
                } catch (thrown) {
                    fail(thrown);
                    return;
                }
                settle('complete', input);
            },
            fail,
        );
        return id;
    };
    return {
        toasts: () => state.items,
        show,
        update,
        promise,
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
    /** The toast's work status (`undefined` for a plain toast). */
    status(): ToastStatus | undefined;
    /** A `Toast.Indicator` joins the toast; returns the leave function. */
    addIndicator(): () => void;
}

const useToastItemContext = defineInjectable<ToastItemContext>(() => ({
    dismiss: () => {},
    status: () => undefined,
    addIndicator: () => () => {},
}));

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
    const status = (): ToastStatus | undefined => props.toast?.status;
    // How many Toast.Indicators this toast holds. A signal: the root's
    // `marked` stamp renders from it.
    const indicators = signal({ count: 0 });
    // `marked`: an indicator is showing its mark. The lynx spelling of the
    // web recipe's `:has(> indicator)`, stamped on every part so the skin
    // can seat the mark beside the text.
    const marked = (): boolean => indicators.count > 0 && status() !== undefined;
    const axes = provideVariantAxes((): VariantAxes => {
        const resolved = resolveVariantAxes(anatomy.scope, {
            color: props.color ?? props.toast?.color,
            size: props.size ?? viewport.size(),
        });
        return marked() ? { ...resolved, mods: { ...resolved.mods, marked: true } } : resolved;
    });
    defineProvide(useToastItemContext, () => ({
        dismiss: () => {
            if (props.toast) viewport.dismiss(props.toast.id);
            emit('dismiss');
        },
        status,
        addIndicator: () => {
            indicators.count++;
            return () => {
                indicators.count = Math.max(0, indicators.count - 1);
            };
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

// ── Indicator ──

export type ToastIndicatorProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

/**
 * The toast's work status as a mark — `data-state` is the toast's `status`
 * (`loading` | `complete` | `error`, which `toaster.promise()` drives). Not
 * rendered while the toast has none. The skin draws the mark (a ring, a
 * tick, a cross); children (an icon) are the app's own. Decorative: the
 * title says it in words, so the mark is hidden from the reader.
 *
 * While it shows, the toast's parts carry the `marked` modifier
 * (`zx-m-marked`), which the skin reads to seat the mark beside the text —
 * lynx has no `:has()`.
 */
const ToastIndicator = component<ToastIndicatorProps>(({ props, slots }) => {
    const item = useToastItemContext();
    const axes = useVariantAxes();
    // Joined one turn after mount: the root renders the `marked` stamp from
    // the count, and a count its render reads must change after the pass
    // that mounted this part, or the root never sees it. (A promise, not
    // `queueMicrotask`: the background thread lacks it on some engines.)
    let leave: (() => void) | null = null;
    let alive = true;
    onMounted(() => {
        void Promise.resolve().then(() => {
            if (alive) leave = item.addIndicator();
        });
    });
    onUnmounted(() => {
        alive = false;
        leave?.();
    });
    return () => {
        const status = item.status();
        if (!status) return null;
        return (
            <view
                {...partBag(anatomy, 'indicator', { state: status, ...partAxes(axes()), class: props.class })}
                accessibility-element={false}
            >
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'Toast.Indicator' });

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

/** The stock composition — zero's: indicator, title, description, action, close. */
const ToastCard = component<ToastCardProps>(({ props }) => {
    return () => {
        const t = props.toast;
        return (
            <ToastRoot toast={t}>
                <ToastIndicator />
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
    //
    // The outlet is the whole window (#1169); the strip pins to the host's
    // SAFE FRAME instead — clear of the status bar and home indicator — while
    // a card's shadow is free to paint into the inset below it.
    const insets = useOverlayInsets();
    const outlet = useOutletRect();
    const edge = (): Record<string, string | number> => {
        const inset = insets();
        // `OVERLAY_ROOT_STYLE`: the strip takes its own touches under the
        // pass-through outlet layer (#1180) — the page outside it still does.
        const style: Record<string, string | number> = {
            ...OVERLAY_ROOT_STYLE,
            position: 'absolute', left: `${inset.left}px`, transform: 'none', display: 'flex',
            // Lynx bounds an absolute child's auto height by its containing
            // block, and the layer is 0×0: size the strip to its cards.
            height: 'max-content',
        };
        // The layer is 0×0 (#1190), so edges against it mean nothing. With
        // the window's size known the strip states its width and pins by its
        // TOP: a bottom strip sits at the frame's bottom edge and lifts itself
        // by its own height (`translateY(-100%)`, which also cancels the
        // skin's web centering transform). Before that, the edge spelling.
        const box = outlet();
        const w = box?.width ?? 0;
        const h = box?.height ?? 0;
        if (w > 0) style['width'] = `${Math.max(0, w - inset.left - inset.right)}px`;
        else style['right'] = `${inset.right}px`;
        if (placement().startsWith('top')) style['top'] = `${inset.top}px`;
        else if (h > 0) {
            style['top'] = `${h - inset.bottom}px`;
            style['transform'] = 'translateY(-100%)';
        } else style['bottom'] = `${inset.bottom}px`;
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
    Indicator: ToastIndicator,
    Title: ToastTitle,
    Description: ToastDescription,
    Action: ToastAction,
    Close: ToastClose,
});
