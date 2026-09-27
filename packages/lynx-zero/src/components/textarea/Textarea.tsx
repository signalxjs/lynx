/**
 * Textarea — a multi-line text field on the native lynx `<textarea>`,
 * carrying zero's textarea anatomy (root, label, textarea).
 *
 * ```tsx
 * <Textarea.Root model={() => state.bio}>
 *     <Textarea.Label>Bio</Textarea.Label>
 *     <Textarea.Textarea placeholder="Tell us about yourself" />
 * </Textarea.Root>
 * ```
 *
 * Input's contract minus the `control` box: a plain `string` model written
 * through on every keystroke (the Root's controllable state is the sigx
 * `Model` the native element binds), the same Field adoption, and no
 * `value` prop (runtime-core's emit collision).
 *
 * The anatomy draws the box on the `textarea` part itself. On lynx that
 * part is a `view` holding the native field, for the reason Input has a
 * `control`: iOS never repaints a native text field's styles after mount,
 * so the part whose classes change with state (invalid border, disabled
 * fade, focus ring) must be a view. The native `<textarea>` inside is the
 * part's TEXT FACE: it wears the part's base and axis classes — the only
 * way the skin's font size, ink, line height and placeholder colour reach a
 * native element (lynx has no CSS inheritance by default) — with the box
 * neutralized inline at mount (transparent, borderless, unpadded; the view
 * owns all of that), and no `data-part`, so it is not a second instance of
 * the part to any oracle. A tap on the box's padding focuses the field.
 *
 * `minRows`/`maxRows` turn autosizing on (`data-autosize`): the native
 * field grows with its content (`auto-height`), capped at `maxRows` lines
 * (`maxlines`). `minRows` is a floor the skin's `min-height` already
 * provides on this platform; the rows count itself has no lynx spelling.
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide, signal } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import type { ControllableState } from '@sigx/zero/behaviors/core';
import { createControllableState, createFormControl, createInertState } from '@sigx/zero/behaviors/core';
import { axisClass, modClass, partClass } from '@sigx/zero/contract/core';
import { partBag } from '../../contract/part.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import type { EnterKeyHint, InvokableElement } from '../../shared/native-text.js';
import { VISUALLY_HIDDEN, focusNative, nativeTextAttrs } from '../../shared/native-text.js';

const anatomy = anatomies.textarea;

interface TextareaContext {
    state: ControllableState<string>;
    disabled(): boolean;
    invalid(): boolean;
    required(): boolean;
    readonly(): boolean;
    focusVisible: { value: boolean };
    axes(): VariantAxes;
    native(): {
        enterkeyhint?: EnterKeyHint;
        maxlength?: number;
        spellcheck?: boolean;
        autocorrect?: 'on' | 'off';
        autofocus?: boolean;
        label?: string;
    };
    /** The autosize bounds, or `undefined` when the box keeps its height. */
    autosize(): { min: number; max: number | undefined } | undefined;
    setEl(el: InvokableElement | null): void;
    focus(): void;
}

function makeInert(): TextareaContext {
    return {
        state: createInertState<string>(''),
        disabled: () => false,
        invalid: () => false,
        required: () => false,
        readonly: () => false,
        focusVisible: { value: false },
        axes: () => ({}),
        native: () => ({}),
        autosize: () => undefined,
        setEl: () => {},
        focus: () => {},
    };
}

const useTextareaContext = defineInjectable<TextareaContext>(() => makeInert());

// ── Root ──

export type TextareaRootProps =
    & Define.Model<string>
    & Define.Prop<'defaultValue', string, false>
    & Define.Event<'valueChange', string>
    & Define.Prop<'maxlength', number, false>
    /** What the keyboard's Enter key says — `send` for a composer, … (lynx `confirm-type`). */
    & Define.Prop<'enterkeyhint', EnterKeyHint, false>
    & Define.Prop<'spellcheck', boolean, false>
    & Define.Prop<'autocorrect', 'on' | 'off', false>
    & Define.Prop<'autofocus', boolean, false>
    /** Grow with the content, never below this floor (turns autosizing on). */
    & Define.Prop<'minRows', number, false>
    /** Grow up to this many lines, then scroll (turns autosizing on). */
    & Define.Prop<'maxRows', number, false>
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'invalid', boolean, false>
    & Define.Prop<'required', boolean, false>
    & Define.Prop<'readonly', boolean, false>
    & Define.Prop<'color', string, false>
    /** Falls back to the enclosing Field's size. */
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    /** Accessible name for the native field. */
    & Define.Prop<'label', string, false>
    & Define.Slot<'default'>;

const TextareaRoot = component<TextareaRootProps>(({ props, slots, emit, onUnmounted }) => {
    const state = createControllableState<string>(
        () => props.model,
        props.defaultValue ?? '',
        (v) => emit('valueChange', v),
    );
    const fc = createFormControl({ props: () => props, idBase: 'zx-textarea', controlPart: 'textarea' });
    const focusVisible = signal({ value: false });
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color, size: props.size ?? fc.field.size(),
    }));
    let el: InvokableElement | null = null;

    const ctx: TextareaContext = {
        state,
        disabled: fc.disabled,
        invalid: fc.invalid,
        required: fc.required,
        readonly: fc.readonly,
        focusVisible,
        axes,
        native: () => ({
            enterkeyhint: props.enterkeyhint,
            maxlength: props.maxlength,
            spellcheck: props.spellcheck,
            autocorrect: props.autocorrect,
            autofocus: props.autofocus,
            label: props.label,
        }),
        autosize: () => {
            if (props.minRows == null && props.maxRows == null) return undefined;
            // Whole rows, at least one; a max below the min is the min; a
            // non-finite max is no bound — zero's normalization.
            const min = Number.isFinite(props.minRows) ? Math.max(1, Math.floor(props.minRows!)) : 1;
            const max = Number.isFinite(props.maxRows) ? Math.max(min, Math.floor(props.maxRows!)) : undefined;
            return { min, max };
        },
        setEl: (node) => { el = node; },
        focus: () => {
            if (!fc.disabled()) focusNative(el);
        },
    };
    defineProvide(useTextareaContext, () => ctx);
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
}, { name: 'Textarea.Root' });

// ── Label ──

export type TextareaLabelProps =
    & Define.Prop<'visuallyHidden', boolean, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const TextareaLabel = component<TextareaLabelProps>(({ props, slots }) => {
    const ctx = useTextareaContext();
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
}, { name: 'Textarea.Label' });

// ── Textarea ──

/**
 * The text face's inline box, fixed at mount (iOS would ignore a later
 * change anyway): the part's view owns background, border, radius, ring
 * and padding, so the face zeroes them and fills the view.
 */
const FACE_STYLE: Record<string, string> = {
    flexGrow: '1',
    width: '100%',
    minHeight: '0px',
    backgroundColor: 'transparent',
    borderWidth: '0px',
    borderRadius: '0px',
    boxShadow: 'none',
    padding: '0px',
    margin: '0px',
};

/** The view's own flow: a column the face stretches to fill. */
const BOX_STYLE: Record<string, string> = { display: 'flex', flexDirection: 'column' };

export type TextareaTextareaProps =
    & Define.Prop<'placeholder', string, false>
    & Define.Prop<'class', string, false>
    & Define.Event<'focus'>
    & Define.Event<'blur'>
    /** The keyboard's Enter key (lynx `bindconfirm`), with the text. */
    & Define.Event<'confirm', string>;

const TextareaTextarea = component<TextareaTextareaProps>(({ props, emit }) => {
    const ctx = useTextareaContext();

    /** The face's classes: the part's base + axis/mod compounds, never a flag. */
    const faceClass = (): string => {
        const a = ctx.axes();
        const classes = [partClass(anatomy.scope, 'textarea')];
        for (const [axis, value] of Object.entries({ color: a.color, size: a.size, variant: a.variant, ...a.axes })) {
            if (value !== undefined) classes.push(axisClass(axis, value));
        }
        for (const [name, on] of Object.entries(a.mods ?? {})) {
            if (on) classes.push(modClass(name));
        }
        return classes.join(' ');
    };

    return () => {
        const native = ctx.native();
        const bounds = ctx.autosize();
        const bag = partBag(anatomy, 'textarea', {
            flags: {
                disabled: ctx.disabled(),
                invalid: ctx.invalid(),
                required: ctx.required(),
                readonly: ctx.readonly(),
                'focus-visible': ctx.focusVisible.value,
            },
            ...partAxes(ctx.axes()),
            class: props.class,
        });
        if (bounds) bag['data-autosize'] = '';
        return (
            <view {...bag} style={BOX_STYLE} bindtap={() => ctx.focus()}>
                <textarea
                    class={faceClass()}
                    style={FACE_STYLE}
                    {...nativeTextAttrs({
                        placeholder: props.placeholder,
                        maxlength: native.maxlength,
                        enterkeyhint: native.enterkeyhint,
                        spellcheck: native.spellcheck,
                        autocorrect: native.autocorrect,
                        autofocus: native.autofocus,
                        disabled: ctx.disabled(),
                        readonly: ctx.readonly(),
                    })}
                    {...(native.label ? { 'accessibility-label': native.label } : {})}
                    {...(bounds ? { 'auto-height': true } : {})}
                    {...(bounds?.max !== undefined ? { maxlines: bounds.max } : {})}
                    model={ctx.state}
                    ref={(node: unknown) => ctx.setEl(node as InvokableElement | null)}
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
            </view>
        );
    };
}, { name: 'Textarea.Textarea' });

export const Textarea = compound(TextareaRoot, {
    Root: TextareaRoot,
    Label: TextareaLabel,
    Textarea: TextareaTextarea,
});
