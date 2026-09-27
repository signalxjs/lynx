/**
 * Input — a single-line text field on the native lynx `<input>`, carrying
 * zero's input anatomy (root, label, control, input, adornment,
 * clear-trigger, visibility-trigger).
 *
 * ```tsx
 * <Input.Root model={() => state.email} type="email">
 *     <Input.Label>Email</Input.Label>
 *     <Input.Control>
 *         <Input.Input placeholder="you@example.com" />
 *         <Input.ClearTrigger />
 *     </Input.Control>
 * </Input.Root>
 * ```
 *
 * The model is a plain `string`, written through on every keystroke — the
 * Root's `createControllableState` IS a sigx `Model`, handed straight to the
 * native element's `model`, so the lynx model processor owns the write-back
 * (and the iOS deferred initial value). There is deliberately no `value`
 * prop: a component prop named `value` breaks `emit` in runtime-core, and
 * the `model` binding is the zero contract anyway.
 *
 * The box is `control`, a `view`: iOS never repaints a native input's
 * styles after mount, so every state that paints (invalid border, disabled
 * fade, focus ring) lands on views, and the native field stays a transparent
 * text face inside. Inside a `Field.Root` the control adopts the field's
 * flags and size, and a tap on the field's label focuses it.
 *
 * Touch platform translations: `focus-visible` is the field's own focus
 * (`bindfocus`/`bindblur` — a text field shows its ring on any focus, as the
 * web's `:focus-visible` does for text inputs); a tap on the control's
 * padding or an adornment focuses the field, the way a web press on them
 * does; the triggers are views with press feedback and `catchtap`, so
 * pressing one never also lands on the control. There is no `name`/`form`
 * (no forms on lynx) and no Escape-to-clear (no hardware Escape).
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide, signal } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import type { ControllableState } from '@sigx/zero/behaviors/core';
import { createControllableState, createFormControl, createInertState, namedModel } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';
import type { EnterKeyHint, InputMode, InputType, InvokableElement } from '../../shared/native-text.js';
import { VISUALLY_HIDDEN, focusNative, lynxInputType, nativeTextAttrs } from '../../shared/native-text.js';

export type { EnterKeyHint, InputMode, InputType } from '../../shared/native-text.js';

const anatomy = anatomies.input;

interface InputContext {
    state: ControllableState<string>;
    /** The type the field renders — a shown password is a text field. */
    type(): InputType;
    visible: ControllableState<boolean>;
    disabled(): boolean;
    invalid(): boolean;
    required(): boolean;
    readonly(): boolean;
    focusVisible: { value: boolean };
    axes(): VariantAxes;
    native(): {
        inputmode?: InputMode;
        enterkeyhint?: EnterKeyHint;
        maxlength?: number;
        spellcheck?: boolean;
        autocorrect?: 'on' | 'off';
        autofocus?: boolean;
        label?: string;
    };
    setInputEl(el: InvokableElement | null): void;
    focus(): void;
    /** Empty the value the way typing would, then focus the field. */
    clear(): void;
}

function makeInert(): InputContext {
    return {
        state: createInertState<string>(''),
        type: () => 'text',
        visible: createInertState<boolean>(false),
        disabled: () => false,
        invalid: () => false,
        required: () => false,
        readonly: () => false,
        focusVisible: { value: false },
        axes: () => ({}),
        native: () => ({}),
        setInputEl: () => {},
        focus: () => {},
        clear: () => {},
    };
}

const useInputContext = defineInjectable<InputContext>(() => makeInert());

// ── Root ──

export type InputRootProps =
    & Define.Model<string>
    & Define.Prop<'defaultValue', string, false>
    & Define.Event<'valueChange', string>
    & Define.Prop<'type', InputType, false>
    & Define.Prop<'maxlength', number, false>
    /** Which virtual keyboard to show — `numeric` / `decimal` pick lynx's digit / number pads. */
    & Define.Prop<'inputmode', InputMode, false>
    /** What the keyboard's Enter key says — lynx's `confirm-type` (`done`, `go`, `next`, `search`, `send`). */
    & Define.Prop<'enterkeyhint', EnterKeyHint, false>
    /** Spell-check the value (iOS). Unset leaves the platform default. */
    & Define.Prop<'spellcheck', boolean, false>
    /** Autocorrection (iOS) — `off` for codes, usernames, addresses. */
    & Define.Prop<'autocorrect', 'on' | 'off', false>
    /** Focus the field when it mounts. */
    & Define.Prop<'autofocus', boolean, false>
    /**
     * Whether a `type="password"` field shows its characters — what
     * `Input.VisibilityTrigger` toggles. On any other type it changes nothing.
     */
    & Define.Model<'visible', boolean>
    & Define.Prop<'defaultVisible', boolean, false>
    & Define.Event<'visibleChange', boolean>
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'invalid', boolean, false>
    & Define.Prop<'required', boolean, false>
    /** Announced and selectable, never edited. The prop OR the Field's. */
    & Define.Prop<'readonly', boolean, false>
    /** The focus accent (daisy: the ring's role). */
    & Define.Prop<'color', string, false>
    /** Falls back to the enclosing Field's size. */
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    /** Accessible name for the native field (the visible label is separate). */
    & Define.Prop<'label', string, false>
    & Define.Slot<'default'>;

const InputRoot = component<InputRootProps>(({ props, slots, emit, onUnmounted }) => {
    const state = createControllableState<string>(
        () => props.model,
        props.defaultValue ?? '',
        (v) => emit('valueChange', v),
    );
    const visible = createControllableState<boolean>(
        () => namedModel<boolean>(props.visible),
        props.defaultVisible ?? false,
        (v) => emit('visibleChange', v),
    );
    const fc = createFormControl({ props: () => props, idBase: 'zx-input', controlPart: 'input' });
    const focusVisible = signal({ value: false });
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color, size: props.size ?? fc.field.size(),
    }));
    // Not reactive: nothing renders from it, the affordances only focus it.
    let inputEl: InvokableElement | null = null;

    const ctx: InputContext = {
        state,
        type: () => {
            const type = props.type ?? 'text';
            return type === 'password' && visible.value ? 'text' : type;
        },
        visible,
        disabled: fc.disabled,
        invalid: fc.invalid,
        required: fc.required,
        readonly: fc.readonly,
        focusVisible,
        axes,
        native: () => ({
            inputmode: props.inputmode,
            enterkeyhint: props.enterkeyhint,
            maxlength: props.maxlength,
            spellcheck: props.spellcheck,
            autocorrect: props.autocorrect,
            autofocus: props.autofocus,
            label: props.label,
        }),
        setInputEl: (el) => { inputEl = el; },
        focus: () => {
            if (!fc.disabled()) focusNative(inputEl);
        },
        clear: () => {
            if (fc.disabled() || fc.readonly()) return;
            state.value = '';
            focusNative(inputEl);
        },
    };
    defineProvide(useInputContext, () => ctx);
    // The Field's label focuses the first control that reports (zero#284's seam).
    fc.reportValidity({ element: () => null, value: () => state.value, focus: () => ctx.focus() }, onUnmounted);

    return () => (
        <view
            {...partBag(anatomy, 'root', {
                flags: { disabled: fc.disabled(), invalid: fc.invalid(), required: fc.required(), readonly: fc.readonly() },
                ...partAxes(axes()),
                class: props.class,
            })}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Input.Root' });

// ── Label ──

export type InputLabelProps =
    & Define.Prop<'visuallyHidden', boolean, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const InputLabel = component<InputLabelProps>(({ props, slots }) => {
    const ctx = useInputContext();
    return () => {
        const bag = partBag(anatomy, 'label', {
            flags: { disabled: ctx.disabled(), invalid: ctx.invalid(), required: ctx.required() },
            ...partAxes(ctx.axes()),
            class: props.class,
        });
        if (props.visuallyHidden) bag['data-visually-hidden'] = '';
        return (
            <text {...bag} style={props.visuallyHidden ? VISUALLY_HIDDEN : undefined} {...{ bindtap: () => ctx.focus() }}>
                {slots.default?.()}
            </text>
        );
    };
}, { name: 'Input.Label' });

// ── Control ──

export type InputControlProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

const InputControl = component<InputControlProps>(({ props, slots }) => {
    const ctx = useInputContext();
    return () => (
        <view
            {...partBag(anatomy, 'control', {
                flags: {
                    disabled: ctx.disabled(),
                    invalid: ctx.invalid(),
                    readonly: ctx.readonly(),
                    'focus-visible': ctx.focusVisible.value,
                },
                ...partAxes(ctx.axes()),
                class: props.class,
            })}
            // The box's own padding (and an adornment) focuses the field.
            bindtap={() => ctx.focus()}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Input.Control' });

// ── Input ──

export type InputInputProps =
    & Define.Prop<'placeholder', string, false>
    & Define.Prop<'class', string, false>
    & Define.Event<'focus'>
    & Define.Event<'blur'>
    /** The keyboard's Enter key — lynx's `bindconfirm`, with the text. */
    & Define.Event<'confirm', string>;

const InputInput = component<InputInputProps>(({ props, emit }) => {
    const ctx = useInputContext();
    return () => {
        const native = ctx.native();
        const type = ctx.type();
        return (
            <input
                {...partBag(anatomy, 'input', {
                    flags: {
                        disabled: ctx.disabled(),
                        invalid: ctx.invalid(),
                        required: ctx.required(),
                        readonly: ctx.readonly(),
                        'focus-visible': ctx.focusVisible.value,
                    },
                    ...partAxes(ctx.axes()),
                    class: props.class,
                })}
                {...nativeTextAttrs({
                    placeholder: props.placeholder,
                    maxlength: native.maxlength,
                    enterkeyhint: native.enterkeyhint,
                    type,
                    spellcheck: native.spellcheck,
                    autocorrect: native.autocorrect,
                    autofocus: native.autofocus,
                    disabled: ctx.disabled(),
                    readonly: ctx.readonly(),
                })}
                {...(native.label ? { 'accessibility-label': native.label } : {})}
                {...({ type: lynxInputType(type, native.inputmode) } as Record<string, unknown>)}
                model={ctx.state}
                ref={(el: unknown) => ctx.setInputEl(el as InvokableElement | null)}
                {...({
                    bindfocus: () => {
                        ctx.focusVisible.value = true;
                        emit('focus');
                    },
                    bindblur: () => {
                        ctx.focusVisible.value = false;
                        emit('blur');
                    },
                    bindconfirm: (e: { detail?: { value?: unknown } }) => {
                        const v = e?.detail?.value;
                        emit('confirm', typeof v === 'string' ? v : ctx.state.value);
                    },
                } as Record<string, unknown>)}
            />
        );
    };
}, { name: 'Input.Input' });

// ── Adornment ──

export type InputAdornmentProps =
    /** Which edge of the control it sits at; rendered as `data-placement`. */
    & Define.Prop<'placement', 'start' | 'end', true>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

/** Consumer content at one edge of the control — an icon, a unit, a prefix. */
const InputAdornment = component<InputAdornmentProps>(({ props, slots }) => {
    const ctx = useInputContext();
    return () => (
        <view
            {...partBag(anatomy, 'adornment', {
                placement: props.placement,
                flags: { disabled: ctx.disabled() },
                ...partAxes(ctx.axes()),
                class: props.class,
            })}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Input.Adornment' });

// ── ClearTrigger ──

export type InputClearTriggerProps =
    /** Accessible name; defaults to `Clear`. */
    & Define.Prop<'label', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

/**
 * Empties the value and focuses the field. Renders nothing while the field
 * is empty (a button that can do nothing is noise, not a state). Inert while
 * disabled or readonly — clearing is an edit.
 */
const InputClearTrigger = component<InputClearTriggerProps>(({ props, slots }) => {
    const ctx = useInputContext();
    const inert = (): boolean => ctx.disabled() || ctx.readonly();
    const press = createPressFeedback({ isDisabled: inert });
    return () => {
        if ((ctx.state.value ?? '') === '') return null;
        return (
            <view
                {...partBag(anatomy, 'clear-trigger', {
                    flags: { disabled: inert(), pressed: press.pressed() },
                    ...partAxes(ctx.axes()),
                    class: props.class,
                })}
                {...partA11y({ trait: 'button', label: props.label ?? 'Clear', disabled: inert() })}
                catchtap={() => ctx.clear()}
                {...press.handlers}
            >
                {slots.default ? slots.default() : <text>×</text>}
            </view>
        );
    };
}, { name: 'Input.ClearTrigger' });

// ── VisibilityTrigger ──

export type InputVisibilityTriggerProps =
    /** Accessible name; defaults to `Show password`. */
    & Define.Prop<'label', string, false>
    & Define.Prop<'class', string, false>
    /** Receives whether the characters are shown, to swap an icon. */
    & Define.Slot<'default', { visible: boolean }>;

/**
 * Toggles `model:visible`. One constant name plus a selected status — a
 * toggle button's contract — rather than a label flipping between "Show"
 * and "Hide", which a reader would announce as a different control.
 */
const InputVisibilityTrigger = component<InputVisibilityTriggerProps>(({ props, slots }) => {
    const ctx = useInputContext();
    const press = createPressFeedback({ isDisabled: () => ctx.disabled() });
    return () => {
        const on = !!ctx.visible.value;
        return (
            <view
                {...partBag(anatomy, 'visibility-trigger', {
                    state: on ? 'on' : 'off',
                    flags: { disabled: ctx.disabled(), pressed: press.pressed() },
                    ...partAxes(ctx.axes()),
                    class: props.class,
                })}
                {...partA11y({ trait: 'button', label: props.label ?? 'Show password', selected: on, disabled: ctx.disabled() })}
                catchtap={() => {
                    if (!ctx.disabled()) ctx.visible.value = !ctx.visible.value;
                }}
                {...press.handlers}
            >
                {slots.default ? slots.default({ visible: on }) : <text>{on ? '○' : '◉'}</text>}
            </view>
        );
    };
}, { name: 'Input.VisibilityTrigger' });

export const Input = compound(InputRoot, {
    Root: InputRoot,
    Label: InputLabel,
    Control: InputControl,
    Input: InputInput,
    Adornment: InputAdornment,
    ClearTrigger: InputClearTrigger,
    VisibilityTrigger: InputVisibilityTrigger,
});
