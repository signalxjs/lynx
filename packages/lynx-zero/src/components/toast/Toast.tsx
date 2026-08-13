/**
 * Toast — the persistent overlay: a store (`createToaster`) plus a viewport
 * that portals ONCE and re-asserts the top of the outlet whenever a toast
 * arrives (hide + show — the registry keeps `show` position-stable on
 * purpose, so climbing is an explicit act). Timed dismissal per toast;
 * placement classes on viewport and roots per the anatomy's declared set.
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide, effect, signal } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import { createPressFeedback } from '../../behaviors/press.js';
import { useOverlayPortal } from '../../overlay/OverlayHost.js';

const anatomy = anatomies.toast;

export type ToastPlacement = 'top-start' | 'top' | 'top-end' | 'bottom-start' | 'bottom' | 'bottom-end';

export interface ToastOptions {
    title: string;
    description?: string;
    /** ms until auto-dismiss; 0 disables the timer. Default 4000. */
    duration?: number;
}

export interface ToastItem extends ToastOptions {
    id: number;
}

export interface Toaster {
    toasts(): ToastItem[];
    show(options: ToastOptions): number;
    dismiss(id: number): void;
}

let nextToastId = 1;

/** The store — creatable headlessly (an app service can toast). */
export function createToaster(): Toaster {
    const state = signal<{ items: ToastItem[] }>({ items: [] });
    const dismiss = (id: number): void => {
        state.items = state.items.filter((t) => t.id !== id);
    };
    return {
        toasts: () => state.items,
        show(options) {
            const id = nextToastId++;
            state.items = [...state.items, { ...options, id }];
            const duration = options.duration ?? 4000;
            if (duration > 0) setTimeout(() => dismiss(id), duration);
            return id;
        },
        dismiss,
    };
}

const useToaster = defineInjectable<Toaster>(() => createToaster());

/** Provide a specific toaster to a subtree (else each viewport owns one). */
export function provideToaster(toaster: Toaster): void {
    defineProvide(useToaster, () => toaster);
}

export type ToastViewportProps =
    & Define.Prop<'placement', ToastPlacement, false>
    /** The store to render. Defaults to the injected/ambient one. */
    & Define.Prop<'toaster', Toaster, false>
    & Define.Prop<'class', string, false>;

const ToastViewport = component<ToastViewportProps>(({ props }) => {
    const ambient = useToaster();
    const toaster = () => props.toaster ?? ambient;
    const placement = (): ToastPlacement => props.placement ?? 'bottom';
    const portal = useOverlayPortal();
    const close = createPressFeedback();

    const edge = (): Record<string, string | number> => {
        const p = placement();
        const style: Record<string, string | number> = { position: 'absolute', left: 0, right: 0 };
        if (p.startsWith('top')) style['top'] = 0;
        else style['bottom'] = 0;
        return style;
    };

    effect(() => {
        const items = toaster().toasts();
        if (items.length === 0) {
            portal.hide();
            return;
        }
        // Re-assert the top on every change: a dialog that opened after the
        // viewport must not cover incoming toasts.
        portal.hide();
        portal.show(() => (
            <view {...partBag(anatomy, 'viewport', { placement: placement(), class: props.class })} style={edge()}>
                {items.map((toast) => (
                    <view key={toast.id} {...partBag(anatomy, 'root', { state: 'open', placement: placement() })}>
                        <text {...partBag(anatomy, 'title', {})}>{toast.title}</text>
                        {toast.description
                            ? <text {...partBag(anatomy, 'description', {})}>{toast.description}</text>
                            : null}
                        <view
                            {...partBag(anatomy, 'close', { flags: { pressed: close.pressed() } })}
                            {...partA11y({ trait: 'button', label: 'Dismiss' })}
                            bindtap={() => toaster().dismiss(toast.id)}
                            {...close.handlers}
                        >
                            <text>×</text>
                        </view>
                    </view>
                ))}
            </view>
        ));
    });

    return () => undefined;
}, { name: 'Toast.Viewport' });

export const Toast = compound(ToastViewport, { Viewport: ToastViewport });
