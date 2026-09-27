/**
 * NumberInput — zero's spinbutton over lynx's native `<input>`.
 *
 * ```tsx
 * <NumberInput.Root model={() => state.qty} min={0} max={99}>
 *     <NumberInput.Label>Quantity</NumberInput.Label>
 *     <NumberInput.Control>
 *         <NumberInput.DecrementTrigger />
 *         <NumberInput.Input />
 *         <NumberInput.IncrementTrigger />
 *     </NumberInput.Control>
 * </NumberInput.Root>
 * ```
 *
 * The model contract is zero's: `number | null` (null = empty — an empty
 * field is not 0). Typing edits an UNCOMMITTED draft; the draft commits on
 * blur and on the keyboard's confirm key (parse → snap → clamp), so a
 * half-typed `-` or `1e` never reaches the model and unparseable text
 * reverts to the last committed value. The triggers commit immediately.
 * An off-grid value steps to the neighbouring grid value in the direction of
 * travel, never past it (`stepToward`, the same math as the web).
 *
 * Lynx projection:
 * - `input` is the native `<input>`. Its visible text rides the `value`
 *   attribute: the runtime turns a programmatic change (a step, a commit
 *   that reformats) into the element's `setValue` and skips the echo of the
 *   user's own typing, so the caret is never disturbed. `type` is `digit`
 *   when `min >= 0` (no minus needed), else `number`. Keep the element
 *   mounted: a remount clears its text.
 * - `control` is the painted field box (iOS inputs ignore post-mount style
 *   updates, so the chrome lives on a view — the #996 split). Native focus
 *   drives `focus-visible` on control + input: a text field shows its ring
 *   on any focus, the way the web's `:focus-visible` matches text inputs.
 * - The triggers are views: a tap steps once, a long press repeats every
 *   `spinInterval` ms until the touch ends (the web's press-and-hold spin).
 *   Each carries the main-thread press feel and the `pressed` flag, and is
 *   `disabled` at its bound, while the root is disabled or read-only.
 * - `hidden-input` is omitted (no forms on lynx; the anatomy oracle walks
 *   rendered parts), and with it `name`. `locale`/`formatOptions` are not
 *   carried — `Intl` is not guaranteed on lynx's JS engines; pass `format`
 *   and `parse` for a custom display.
 * - Flags follow zero's form-control regime (`createFormControl`): the prop
 *   OR the enclosing `Field`'s OR any enclosing `Fieldset`'s; `invalid` also
 *   turns on for a committed value outside `[min, max]`.
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide, signal } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { createControllableState, createFormControl } from '@sigx/zero/behaviors/core';
import type { ControllableState } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';
import { clamp, parseDecimal, snapToStep, stepToward } from './number.js';

const anatomy = anatomies['number-input'];

/** Default ms between repeat steps while a trigger is long-pressed. */
export const NUMBER_INPUT_SPIN_INTERVAL = 80;

interface NumberInputContext {
    state: ControllableState<number | null>;
    disabled(): boolean;
    invalid(): boolean;
    required(): boolean;
    readonly(): boolean;
    focused(): boolean;
    setFocused(on: boolean): void;
    /** The text the input shows: the draft while typing, the formatted model otherwise. */
    displayValue(): string;
    /** Record typed text as the uncommitted draft. */
    setDraft(text: string): void;
    commit(): void;
    canStep(direction: 1 | -1): boolean;
    stepBy(direction: 1 | -1): void;
    inputType(): 'digit' | 'number';
    spinInterval(): number;
    label(): string | undefined;
}

const INERT: NumberInputContext = {
    state: { value: null } as ControllableState<number | null>,
    disabled: () => false,
    invalid: () => false,
    required: () => false,
    readonly: () => false,
    focused: () => false,
    setFocused: () => {},
    displayValue: () => '',
    setDraft: () => {},
    commit: () => {},
    canStep: () => false,
    stepBy: () => {},
    inputType: () => 'number',
    spinInterval: () => NUMBER_INPUT_SPIN_INTERVAL,
    label: () => undefined,
};

const useNumberInputContext = defineInjectable<NumberInputContext>(() => INERT);

// ── Root ──

export type NumberInputRootProps =
    /** `number | null` — null is an empty field, not 0. */
    & Define.Model<number | null>
    & Define.Prop<'defaultValue', number | null, false>
    & Define.Event<'valueChange', number | null>
    & Define.Prop<'min', number, false>
    & Define.Prop<'max', number, false>
    /** Grid step, anchored at `min` (default 1). */
    & Define.Prop<'step', number, false>
    /** Clamp an out-of-range commit into [min, max] (default true). */
    & Define.Prop<'clampOnBlur', boolean, false>
    /** Display text for the committed value (default `String`). */
    & Define.Prop<'format', (value: number) => string, false>
    /** Parse typed text; return null for "not a number" (default lenient decimal). */
    & Define.Prop<'parse', (text: string) => number | null, false>
    /** ms between repeat steps while a trigger is long-pressed (default 80). */
    & Define.Prop<'spinInterval', number, false>
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'invalid', boolean, false>
    & Define.Prop<'required', boolean, false>
    /** Announced and focusable, never edited. The prop OR the Field's / Fieldset's. */
    & Define.Prop<'readonly', boolean, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    /** Accessible name for the input (the visible Label part is separate). */
    & Define.Prop<'label', string, false>
    & Define.Slot<'default'>;

const NumberInputRoot = component<NumberInputRootProps>(({ props, slots, emit }) => {
    const state = createControllableState<number | null>(
        () => props.model,
        props.defaultValue ?? null,
        (v) => emit('valueChange', v),
    );
    const local = signal({ draft: null as string | null, focused: false });

    const outOfRange = (): boolean => {
        const v = state.value;
        if (v == null) return false;
        return (props.min !== undefined && v < props.min) || (props.max !== undefined && v > props.max);
    };
    const fc = createFormControl({ props: () => props, idBase: 'zx-number', controlPart: 'input', invalid: outOfRange });
    const disabled = fc.disabled;
    const readonly = fc.readonly;

    // Coerced, not trusted: snapToStep divides by it.
    const step = (): number => {
        const s = props.step;
        return typeof s === 'number' && Number.isFinite(s) && s > 0 ? s : 1;
    };
    const format = (v: number): string => (props.format ? props.format(v) : String(v));
    const parse = (t: string): number | null => (props.parse ? props.parse(t) : parseDecimal(t));
    const settle = (v: number): number => clamp(snapToStep(v, step(), props.min), props.min, props.max);

    const commit = (): void => {
        const text = local.draft;
        if (text === null) return;
        local.draft = null;
        const trimmed = text.trim();
        if (trimmed === '') {
            state.value = null;
            return;
        }
        const parsed = parse(trimmed);
        // Unparseable → revert (the display falls back to the model).
        if (parsed === null || !Number.isFinite(parsed)) return;
        state.value = (props.clampOnBlur ?? true) ? settle(parsed) : snapToStep(parsed, step(), props.min);
    };

    const canStep = (direction: 1 | -1): boolean => {
        if (disabled() || readonly()) return false;
        const v = state.value;
        if (v == null) return true;
        return direction > 0
            ? !(props.max !== undefined && v >= props.max)
            : !(props.min !== undefined && v <= props.min);
    };

    const stepBy = (direction: 1 | -1): void => {
        if (disabled() || readonly()) return;
        commit();
        const current = state.value;
        // From empty, the first step lands on the floor of the range (or 0).
        state.value = current == null
            ? settle(props.min ?? 0)
            : settle(stepToward(current, direction, step(), props.min));
    };

    const ctx: NumberInputContext = {
        state,
        disabled,
        invalid: fc.invalid,
        required: fc.required,
        readonly,
        focused: () => local.focused,
        setFocused: (on) => { local.focused = on; },
        displayValue: () => {
            if (local.draft !== null) return local.draft;
            const v = state.value;
            return v == null ? '' : format(v);
        },
        setDraft: (text) => {
            if (disabled() || readonly()) return;
            local.draft = text;
        },
        commit,
        canStep,
        stepBy,
        inputType: () => (props.min !== undefined && props.min >= 0 ? 'digit' : 'number'),
        spinInterval: () => {
            const i = props.spinInterval;
            return typeof i === 'number' && Number.isFinite(i) && i > 0 ? i : NUMBER_INPUT_SPIN_INTERVAL;
        },
        label: () => props.label,
    };
    defineProvide(useNumberInputContext, () => ctx);

    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color,
        // The Field's size means the whole field (zero's form-control regime).
        size: props.size ?? fc.field.size(),
    }));

    return () => (
        <view
            {...partBag(anatomy, 'root', {
                flags: { disabled: disabled(), invalid: ctx.invalid(), required: ctx.required(), readonly: readonly() },
                ...partAxes(axes()),
                class: props.class,
            })}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'NumberInput.Root' });

// ── Label ──

export type NumberInputLabelProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

const NumberInputLabel = component<NumberInputLabelProps>(({ props, slots }) => {
    const ctx = useNumberInputContext();
    const axes = useVariantAxes();
    return () => (
        <text
            {...partBag(anatomy, 'label', {
                flags: { disabled: ctx.disabled(), invalid: ctx.invalid(), required: ctx.required() },
                ...partAxes(axes()),
                class: props.class,
            })}
        >
            {slots.default?.()}
        </text>
    );
}, { name: 'NumberInput.Label' });

// ── Control ──

export type NumberInputControlProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

const NumberInputControl = component<NumberInputControlProps>(({ props, slots }) => {
    const ctx = useNumberInputContext();
    const axes = useVariantAxes();
    return () => (
        <view
            {...partBag(anatomy, 'control', {
                flags: {
                    disabled: ctx.disabled(),
                    invalid: ctx.invalid(),
                    readonly: ctx.readonly(),
                    'focus-visible': ctx.focused(),
                },
                ...partAxes(axes()),
                class: props.class,
            })}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'NumberInput.Control' });

// ── Input ──

export type NumberInputInputProps =
    & Define.Prop<'placeholder', string, false>
    & Define.Prop<'class', string, false>;

interface InputEventLike {
    detail?: { value?: unknown };
}

const NumberInputInput = component<NumberInputInputProps>(({ props }) => {
    const ctx = useNumberInputContext();
    const axes = useVariantAxes();
    const textOf = (e: InputEventLike): string => {
        const v = e?.detail?.value;
        return v == null ? '' : String(v);
    };

    // The native element's lynx surface (`bind*`, `digit`, lowercase
    // `readonly`, `confirm-type`) is outside the DOM typing the intrinsic
    // `input` resolves to in this package, so it rides a plain bag.
    const handlers: Record<string, unknown> = {
        bindinput: (e: InputEventLike) => ctx.setDraft(textOf(e)),
        bindfocus: () => ctx.setFocused(true),
        bindblur: () => {
            ctx.setFocused(false);
            ctx.commit();
        },
        bindconfirm: () => ctx.commit(),
    };

    return () => {
        const native: Record<string, unknown> = {
            type: ctx.inputType(),
            'confirm-type': 'done',
            value: ctx.displayValue(),
            disabled: ctx.disabled(),
            readonly: ctx.readonly(),
        };
        // Optional string props are omitted rather than sent as undefined:
        // an unset string prop reaches iOS as NSNull.
        if (props.placeholder !== undefined) native['placeholder'] = props.placeholder;
        const label = ctx.label();
        if (label !== undefined) native['accessibility-label'] = label;
        return (
            <input
                {...partBag(anatomy, 'input', {
                    flags: {
                        disabled: ctx.disabled(),
                        invalid: ctx.invalid(),
                        required: ctx.required(),
                        readonly: ctx.readonly(),
                        'focus-visible': ctx.focused(),
                    },
                    ...partAxes(axes()),
                    class: props.class,
                })}
                {...native}
                {...handlers}
            />
        );
    };
}, { name: 'NumberInput.Input' });

// ── Triggers ──

export type NumberInputTriggerProps =
    /** Accessible name (default "Increment" / "Decrement"). */
    & Define.Prop<'label', string, false>
    & Define.Prop<'class', string, false>
    /** Replaces the default `+` / `−` glyph. */
    & Define.Slot<'default'>;

type TouchHandler = (event?: unknown) => void;

/** Chain two handler bags so a key both define runs both, in order. */
function chainHandlers(a: Record<string, unknown>, b: Record<string, TouchHandler>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...a };
    for (const [key, fn] of Object.entries(b)) {
        const prev = out[key];
        out[key] = typeof prev === 'function'
            ? (event?: unknown) => {
                (prev as TouchHandler)(event);
                fn(event);
            }
            : fn;
    }
    return out;
}

function makeTrigger(direction: 1 | -1, part: 'increment-trigger' | 'decrement-trigger', name: string) {
    return component<NumberInputTriggerProps>(({ props, slots, onUnmounted }) => {
        const ctx = useNumberInputContext();
        const axes = useVariantAxes();
        const inert = (): boolean => !ctx.canStep(direction);
        const press = createPressFeedback({ isDisabled: inert });

        // Long-press spin: the tap steps once; a long press repeats until
        // the touch ends, and swallows the tap that may follow it.
        let timer: ReturnType<typeof setInterval> | null = null;
        let spun = false;
        const stop = (): void => {
            if (timer !== null) clearInterval(timer);
            timer = null;
        };
        onUnmounted(stop);
        const spin: Record<string, TouchHandler> = {
            bindtouchstart: () => {
                spun = false;
            },
            bindtouchend: stop,
            bindtouchcancel: stop,
        };

        return () => {
            const disabled = inert();
            return (
                <view
                    {...partBag(anatomy, part, {
                        flags: { disabled, pressed: press.pressed() },
                        ...partAxes(axes()),
                        class: props.class,
                    })}
                    {...partA11y({
                        trait: 'button',
                        label: props.label ?? (direction > 0 ? 'Increment' : 'Decrement'),
                        disabled,
                    })}
                    bindtap={() => {
                        if (spun) {
                            spun = false;
                            return;
                        }
                        if (!inert()) ctx.stepBy(direction);
                    }}
                    bindlongpress={() => {
                        if (inert()) return;
                        spun = true;
                        ctx.stepBy(direction);
                        stop();
                        timer = setInterval(() => {
                            if (inert()) {
                                stop();
                                return;
                            }
                            ctx.stepBy(direction);
                        }, ctx.spinInterval());
                    }}
                    {...chainHandlers(press.handlers as unknown as Record<string, unknown>, spin)}
                >
                    {slots.default ? slots.default() : <text>{direction > 0 ? '+' : '−'}</text>}
                </view>
            );
        };
    }, { name });
}

const NumberInputIncrementTrigger = makeTrigger(1, 'increment-trigger', 'NumberInput.IncrementTrigger');
const NumberInputDecrementTrigger = makeTrigger(-1, 'decrement-trigger', 'NumberInput.DecrementTrigger');

export const NumberInput = compound(NumberInputRoot, {
    Root: NumberInputRoot,
    Label: NumberInputLabel,
    Control: NumberInputControl,
    Input: NumberInputInput,
    IncrementTrigger: NumberInputIncrementTrigger,
    DecrementTrigger: NumberInputDecrementTrigger,
});
