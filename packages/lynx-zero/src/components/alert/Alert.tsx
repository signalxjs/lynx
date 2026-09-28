/**
 * Alert — a message that announces itself, and can be dismissed (zero's
 * `alert` scope). The parts compose like zero's web Alert:
 *
 * ```tsx
 * <Alert.Root color="warning">
 *     <Alert.Icon><text>⚠</text></Alert.Icon>
 *     <Alert.Title>Approaching your quota</Alert.Title>
 *     <Alert.Description>You have used 92% of this month's allowance.</Alert.Description>
 *     <Alert.Close />
 * </Alert.Root>
 * ```
 *
 * The lynx spellings:
 *
 * - **Presence is the model.** `open|closed` (`model` / `defaultOpen` /
 *   `openChange`, zero's names; open by default — an alert is rendered
 *   because there is something to say). A closed alert UNMOUNTS: lynx has
 *   no `hidden` attribute to honour, and unmounting is the lynx spelling of
 *   the anatomy's `hiddenIn: ['closed']` (the Tabs panel precedent).
 * - **No live region.** Lynx has no `role="alert"` / `aria-live`; the root
 *   carries no accessibility props of its own (marking it an accessible
 *   element would hide its text from the reader on iOS), so the title and
 *   description are read as the text they are. `live` and `finalFocus`
 *   have nothing to drive on this platform and are not taken.
 * - **Icon is decoration** — out of the accessibility tree (zero's
 *   `aria-hidden`): the severity it paints is already in the words.
 * - **Title and Description are `<text>` parts**; pass a string.
 * - **Close** is a `view` with `bindtap`, the `button` trait and the name
 *   "Close" (`label` overrides), tier-2 press feedback like Button, and
 *   `disabled` / `pressed` flags. `focus-visible` is reachable through
 *   `ForceStates` only (no keyboard focus on this platform). With no
 *   children it draws `×`.
 * - **Presence mods for the skin.** The web skin lays the alert out on a
 *   grid; lynx has no grid and no `:has()`, so the root tracks whether an
 *   Icon and a Close are rendered and stamps `with-icon` / `with-close` on
 *   the title and description (`zx-m-with-icon`, `zx-m-with-close`) — the
 *   skin reserves the icon's column and the close button's corner from
 *   them. They are a lynx-zero rendering detail, not modifiers an author
 *   sets (ToggleGroup's `first` / `last` precedent).
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide, signal } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { createControllableState } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';

const anatomy = anatomies.alert;

interface AlertContext {
    close(): void;
    /** Report an Icon / Close as rendered; returns the leave function. */
    register(part: 'icon' | 'close'): () => void;
    /** The presence mods the text parts stamp. */
    presence(): { 'with-icon': boolean; 'with-close': boolean };
}

const useAlertContext = defineInjectable<AlertContext>(() => ({
    close: () => {},
    register: () => () => {},
    presence: () => ({ 'with-icon': false, 'with-close': false }),
}));

// ── Root ──

export type AlertRootProps =
    & Define.Model<boolean>
    & Define.Prop<'defaultOpen', boolean, false>
    & Define.Event<'openChange', boolean>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const AlertRoot = component<AlertRootProps>(({ props, slots, emit }) => {
    const state = createControllableState<boolean>(
        () => props.model,
        props.defaultOpen ?? true,
        (value) => emit('openChange', value),
    );
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color, size: props.size,
    }));
    // Counts, not booleans: two Close buttons (or one remounting) must not
    // clear the mod while one is still rendered.
    const present = signal({ icon: 0, close: 0 });
    defineProvide(useAlertContext, () => ({
        close: () => { state.value = false; },
        register: (part) => {
            present[part] += 1;
            return () => { present[part] = Math.max(0, present[part] - 1); };
        },
        presence: () => ({ 'with-icon': present.icon > 0, 'with-close': present.close > 0 }),
    }));

    return () => {
        if (!state.value) return null;
        return (
            <view
                {...partBag(anatomy, 'root', {
                    state: 'open',
                    ...partAxes(axes()),
                    class: props.class,
                })}
            >
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'Alert.Root' });

// ── Icon ──

type PartProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

export type AlertIconProps = PartProps;

const AlertIcon = component<AlertIconProps>(({ props, slots, onUnmounted }) => {
    const axes = useVariantAxes();
    onUnmounted(useAlertContext().register('icon'));
    return () => (
        // Decorative: the severity it paints is already carried by the text.
        <view
            {...partBag(anatomy, 'icon', { ...partAxes(axes()), class: props.class })}
            accessibility-element={false}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Alert.Icon' });

// ── Title / Description ──

export type AlertTitleProps = PartProps;
export type AlertDescriptionProps = PartProps;

function makeText(part: 'title' | 'description', name: string) {
    return component<PartProps>(({ props, slots }) => {
        const axes = useVariantAxes();
        const alert = useAlertContext();
        return () => {
            const a = partAxes(axes());
            return (
                <text {...partBag(anatomy, part, { ...a, mods: { ...a.mods, ...alert.presence() }, class: props.class })}>
                    {slots.default?.()}
                </text>
            );
        };
    }, { name });
}

const AlertTitle = makeText('title', 'Alert.Title');
const AlertDescription = makeText('description', 'Alert.Description');

// ── Close ──

export type AlertCloseProps =
    & Define.Prop<'disabled', boolean, false>
    /** `false` turns off the main-thread press feel (the pressed flag stays). */
    & Define.Prop<'pressFeel', boolean, false>
    & Define.Prop<'class', string, false>
    /** Accessible name (default "Close"). */
    & Define.Prop<'label', string, false>
    & Define.Slot<'default'>;

const AlertClose = component<AlertCloseProps>(({ props, slots, onUnmounted }) => {
    const axes = useVariantAxes();
    const alert = useAlertContext();
    onUnmounted(alert.register('close'));
    const disabled = (): boolean => !!props.disabled;
    // Read once: the feel is wired at setup (worklet handlers), not per render.
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
                if (!disabled()) alert.close();
            }}
            {...press.handlers}
        >
            {slots.default?.() ?? <text>×</text>}
        </view>
    );
}, { name: 'Alert.Close' });

export const Alert = compound(AlertRoot, {
    Root: AlertRoot,
    Icon: AlertIcon,
    Title: AlertTitle,
    Description: AlertDescription,
    Close: AlertClose,
});
