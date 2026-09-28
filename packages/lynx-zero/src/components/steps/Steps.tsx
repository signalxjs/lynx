/**
 * Steps — a wizard's step rail (zero's `steps` scope).
 *
 * ```tsx
 * <Steps.Root defaultStep="details" linear>
 *     <Steps.Item value="cart">
 *         <Steps.Indicator><text>1</text></Steps.Indicator>
 *         <Steps.Title>Cart</Steps.Title>
 *         <Steps.Separator />
 *     </Steps.Item>
 *     <Steps.Item value="details">
 *         <Steps.Indicator><text>2</text></Steps.Indicator>
 *         <Steps.Title>Details</Steps.Title>
 *     </Steps.Item>
 *     <Steps.Content value="cart"><text>…</text></Steps.Content>
 *     <Steps.Content value="details"><text>…</text></Steps.Content>
 *     <Steps.PrevTrigger><text>Back</text></Steps.PrevTrigger>
 *     <Steps.NextTrigger><text>Next</text></Steps.NextTrigger>
 * </Steps.Root>
 * ```
 *
 * The model is the `step` (`model` / `defaultStep` / `stepChange`). An item
 * before the active one is `complete`, the active one `active`, the rest
 * `inactive` — derived from the items' order. The indicator mirrors its
 * item's phase; the separator (the line from this step toward the next) is
 * `complete` once its own item is, else `inactive`.
 *
 * What the platform changes:
 * - **Mount order is the order.** There is no DOM to sort, so the root
 *   tracks its items in mount order (ToggleGroup's rule): the depth-first
 *   render order, which is the visual order. An item mounted later (a
 *   conditional one) joins the END of that order.
 * - **No keyboard.** Activation is a tap on an item; zero's roving focus,
 *   arrow keys and `loop` are the web's keyboard half and are not taken.
 *   `focus-visible` is reachable through `ForceStates` only.
 * - **Inactive panels unmount** (Tabs' rule): lynx has no `hidden`, so
 *   absence is this platform's spelling of the anatomy's `hiddenIn`. The
 *   web's `lazyMount` has nothing to switch and is not taken.
 * - **A bound or a locked step is `disabled`.** Prev on the first step and
 *   Next on the last are inert and stamp `disabled`; under `linear`, every
 *   item past the next reachable one does too. With no keyboard focus to
 *   keep, the web's aria-disabled-but-focusable distinction collapses.
 * - **`wizard` is stamped.** The web recipe wraps the rail onto its own line
 *   when the root holds a panel or a trigger, through `:has()`; lynx has no
 *   `:has()`, so the root stamps `wizard` (`zx-m-wizard`) while any Content,
 *   PrevTrigger or NextTrigger is mounted, and the skin wraps on that.
 * - **Each item is one accessible element** with the `button` trait,
 *   `selected` while active and `disabled` while inert. Give it a `label`
 *   (its step's name); an `invalid` item appends the root's `invalidLabel`
 *   (", has errors") to it — lynx has no `aria-invalid`.
 *
 * The item re-carries `color` (zero#112, `provideCarriedAxes`): a `color` on
 * one Item paints that step alone, and its indicator and separator follow.
 *
 * Item and Content take a `value` prop and emit nothing — runtime-core
 * resolves a component's event handlers through `props.value` when one
 * exists. The ROOT emits `stepChange` and has no `value` prop.
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide, signal } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { createControllableState } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideCarriedAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';
import { joinAfterMount } from '../../shared/join-after-mount.js';
import { VISUALLY_HIDDEN } from '../../shared/native-text.js';

const anatomy = anatomies.steps;

type Orientation = 'horizontal' | 'vertical';

export type StepsPhase = 'active' | 'complete' | 'inactive';

/** One registered step: its value and whether it is disabled (never `linear`-locked). */
export interface StepsEntry {
    value: string;
    disabled: boolean;
}

const DEFAULT_INVALID_LABEL = ', has errors';

/**
 * A step's phase from the ordered steps and the current one — the pure half
 * of the item. Nothing current: everything `inactive`. The current step not
 * in the list: before the list has settled it registers AFTER every step
 * seen so far (render order), so those are `complete`; once settled, a
 * value no step carries walks nothing.
 */
export function stepsPhase(values: readonly string[], current: string, value: string, settled: boolean): StepsPhase {
    if (!current) return 'inactive';
    if (value === current) return 'active';
    const active = values.indexOf(current);
    if (active === -1) return settled ? 'inactive' : 'complete';
    const mine = values.indexOf(value);
    return mine !== -1 && mine < active ? 'complete' : 'inactive';
}

/**
 * The step Prev (-1) / Next (1) moves to: the nearest ENABLED step before /
 * after the current one, in order. With no current step Next is the first
 * enabled step and Prev has nowhere to go; `undefined` is a bound.
 */
export function stepsTarget(entries: readonly StepsEntry[], current: string, direction: -1 | 1): string | undefined {
    const at = current ? entries.findIndex((e) => e.value === current) : -1;
    if (at === -1) return direction === 1 && !current ? entries.find((e) => !e.disabled)?.value : undefined;
    const ahead = direction === 1 ? entries.slice(at + 1) : entries.slice(0, at).reverse();
    return ahead.find((e) => !e.disabled)?.value;
}

/**
 * `linear`'s gate: a step is locked when it sits AFTER the next reachable
 * one (the Next target, or the current step when there is none). Going
 * back is never gated.
 */
export function stepsLocked(entries: readonly StepsEntry[], current: string, value: string): boolean {
    const mine = entries.findIndex((e) => e.value === value);
    if (mine === -1) return false;
    const at = current ? entries.findIndex((e) => e.value === current) : -1;
    if (current && at === -1) return false;
    const next = stepsTarget(entries, current, 1);
    const reach = next === undefined ? at : entries.findIndex((e) => e.value === next);
    return mine > Math.max(reach, at);
}

interface StepsContext {
    current(): string;
    select(value: string): void;
    orientation(): Orientation;
    disabled(): boolean;
    invalidLabel(): string;
    pressFeel(): boolean;
    /** Join the order (mount order); returns the leave function. */
    register(value: string, disabled: () => boolean): () => void;
    phase(value: string): StepsPhase;
    locked(value: string): boolean;
    target(direction: -1 | 1): string | undefined;
    /** A wizard part (Content, Prev/Next) mounted; returns its unmount. */
    joinWizard(): () => void;
}

interface StepsItemContext {
    phase(): StepsPhase;
    invalid(): boolean;
}

const makeInert = (): StepsContext => ({
    current: () => '',
    select: () => {},
    orientation: () => 'horizontal',
    disabled: () => false,
    invalidLabel: () => DEFAULT_INVALID_LABEL,
    pressFeel: () => true,
    register: () => () => {},
    phase: () => 'inactive',
    locked: () => false,
    target: () => undefined,
    joinWizard: () => () => {},
});

const useStepsContext = defineInjectable<StepsContext>(makeInert);
const useStepsItemContext = defineInjectable<StepsItemContext>(() => ({
    phase: () => 'inactive',
    invalid: () => false,
}));

/** Registration ids, unique across every rail (only compared, never shown). */
let nextStepId = 0;

// ── Root ──

export type StepsRootProps =
    & Define.Model<string>
    & Define.Prop<'defaultStep', string, false>
    & Define.Event<'stepChange', string>
    & Define.Prop<'orientation', Orientation, false>
    /**
     * Linear wizard: only the steps up to the next reachable one can be
     * activated — every later item is disabled, and Next never skips.
     * Going back is never gated.
     */
    & Define.Prop<'linear', boolean, false>
    /** Appended to an `invalid` item's accessible name. Default `', has errors'`. */
    & Define.Prop<'invalidLabel', string, false>
    & Define.Prop<'disabled', boolean, false>
    /** `false` turns off the main-thread press feel (the pressed flag stays). */
    & Define.Prop<'pressFeel', boolean, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const StepsRoot = component<StepsRootProps>(({ props, slots, emit, onMounted }) => {
    const state = createControllableState<string>(
        () => props.model,
        props.defaultStep ?? '',
        (value) => emit('stepChange', value),
    );
    const orientation = (): Orientation => props.orientation ?? 'horizontal';
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, { color: props.color, size: props.size }));

    // The steps in mount order, replaced (never mutated) so a join or a
    // leave re-renders every reader. Entries live outside the signal: a
    // reactive container would deep-proxy the readers they hold.
    const reg = signal({ order: [] as number[], settled: false, wizard: 0 });
    const entries = new Map<number, { value: string; disabled: () => boolean }>();
    // Children mount before their parent: by now every step has registered.
    onMounted(() => { reg.settled = true; });

    const ordered = (): StepsEntry[] => reg.order.flatMap((id) => {
        const entry = entries.get(id);
        return entry ? [{ value: entry.value, disabled: entry.disabled() }] : [];
    });
    const values = (): string[] => ordered().map((e) => e.value);

    const ctx: StepsContext = {
        current: () => state.value ?? '',
        select: (value) => {
            if (!props.disabled) state.value = value;
        },
        orientation,
        disabled: () => !!props.disabled,
        invalidLabel: () => props.invalidLabel ?? DEFAULT_INVALID_LABEL,
        pressFeel: () => props.pressFeel !== false,
        register: (value, disabled) => {
            const id = ++nextStepId;
            entries.set(id, { value, disabled });
            reg.order = [...reg.order, id];
            return () => {
                entries.delete(id);
                reg.order = reg.order.filter((other) => other !== id);
            };
        },
        phase: (value) => stepsPhase(values(), state.value ?? '', value, reg.settled),
        locked: (value) => !!props.linear && stepsLocked(ordered(), state.value ?? '', value),
        target: (direction) => stepsTarget(ordered(), state.value ?? '', direction),
        joinWizard: () => {
            reg.wizard++;
            return () => { reg.wizard--; };
        },
    };
    defineProvide(useStepsContext, () => ctx);

    return () => {
        const a = partAxes(axes());
        return (
            <view
                {...partBag(anatomy, 'root', {
                    flags: { disabled: !!props.disabled },
                    orientation: orientation(),
                    ...a,
                    mods: { ...a.mods, wizard: reg.wizard > 0 },
                    class: props.class,
                })}
            >
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'Steps.Root' });

// ── Item ──

export type StepsItemProps =
    /** This step's value in the rail's model. */
    & Define.Prop<'value', string, true>
    /** This step's own colour (zero#112): outranks the root's for its disc and line. */
    & Define.Prop<'color', string, false>
    & Define.Prop<'disabled', boolean, false>
    /** The step has errors: `invalid` on the item, its indicator and its separator. */
    & Define.Prop<'invalid', boolean, false>
    /** Accessible name — the step's name. */
    & Define.Prop<'label', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

/** `''` is the model's "no current step": a part carrying it could never be current. */
function assertStepValue(value: string, part: string): void {
    if (value === '') {
        throw new Error(`[@sigx/lynx-zero] Steps.${part}: the value "" is reserved for "no current step" — give it a non-empty value`);
    }
}

const StepsItem = component<StepsItemProps>(({ props, slots, onUnmounted }) => {
    assertStepValue(props.value, 'Item');
    const steps = useStepsContext();
    const axes = provideCarriedAxes(anatomy, 'item', () => ({ color: props.color }));
    const disabled = (): boolean => !!props.disabled || steps.disabled();
    // `linear`'s lock is not `disabled` in the model: Next's target skips
    // only disabled steps, never a locked one.
    const locked = (): boolean => !disabled() && steps.locked(props.value);
    const inert = (): boolean => disabled() || locked();
    const press = createPressFeedback({ isDisabled: inert, feel: steps.pressFeel() });
    // Registered under the value it had at setup, like a tab.
    onUnmounted(steps.register(props.value, disabled));

    const phase = (): StepsPhase => steps.phase(props.value);
    defineProvide(useStepsItemContext, () => ({ phase, invalid: () => !!props.invalid }));

    return () => {
        const current = phase();
        const invalid = !!props.invalid;
        return (
            <view
                {...partBag(anatomy, 'item', {
                    state: current,
                    flags: { disabled: inert(), invalid, pressed: press.pressed() },
                    orientation: steps.orientation(),
                    ...partAxes(axes()),
                    class: props.class,
                })}
                {...partA11y({
                    trait: 'button',
                    label: props.label !== undefined && invalid ? `${props.label}${steps.invalidLabel()}` : props.label,
                    selected: current === 'active' || undefined,
                    disabled: inert(),
                })}
                bindtap={() => {
                    if (!inert()) steps.select(props.value);
                }}
                {...press.handlers}
            >
                {slots.default?.()}
                {/* No label to append to: the words ride in the tree, out of sight. */}
                {invalid && props.label === undefined
                    ? <text style={VISUALLY_HIDDEN}>{steps.invalidLabel()}</text>
                    : null}
            </view>
        );
    };
}, { name: 'Steps.Item' });

// ── Bands ──

export type StepsPartProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

/** The numbered disc — its content (a `<text>`) is the step's number or mark. */
const StepsIndicator = component<StepsPartProps>(({ props, slots }) => {
    const item = useStepsItemContext();
    const axes = useVariantAxes();
    return () => (
        <view
            {...partBag(anatomy, 'indicator', {
                state: item.phase(),
                flags: { invalid: item.invalid() },
                ...partAxes(axes()),
                class: props.class,
            })}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Steps.Indicator' });

export type StepsSeparatorProps = Define.Prop<'class', string, false>;

/** The line from this step toward the next — decoration, never a tap target. */
const StepsSeparator = component<StepsSeparatorProps>(({ props }) => {
    const steps = useStepsContext();
    const item = useStepsItemContext();
    const axes = useVariantAxes();
    return () => (
        <view
            {...partBag(anatomy, 'separator', {
                state: item.phase() === 'complete' ? 'complete' : 'inactive',
                flags: { invalid: item.invalid() },
                orientation: steps.orientation(),
                ...partAxes(axes()),
                class: props.class,
            })}
            accessibility-element={false}
        />
    );
}, { name: 'Steps.Separator' });

/** Title and Description are `<text>` parts: pass a string. */
const textPart = (part: 'title' | 'description', name: string) =>
    component<StepsPartProps>(({ props, slots }) => {
        const axes = useVariantAxes();
        return () => (
            <text {...partBag(anatomy, part, { ...partAxes(axes()), class: props.class })}>
                {slots.default?.()}
            </text>
        );
    }, { name });

const StepsTitle = textPart('title', 'Steps.Title');
const StepsDescription = textPart('description', 'Steps.Description');

// ── Content ──

export type StepsContentProps =
    /** The step this panel belongs to — an item's `value`. */
    & Define.Prop<'value', string, true>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const StepsContent = component<StepsContentProps>(({ props, slots, onMounted, onUnmounted }) => {
    assertStepValue(props.value, 'Content');
    const steps = useStepsContext();
    const axes = useVariantAxes();
    onUnmounted(joinAfterMount(onMounted, steps.joinWizard));
    const isActive = (): boolean => steps.current() === props.value;
    // See the module doc: absence is this platform's `hiddenIn`. The panel
    // component stays mounted (and joined) either way; only its part leaves.
    return () => (isActive()
        ? (
            <view
                {...partBag(anatomy, 'content', {
                    state: 'active',
                    orientation: steps.orientation(),
                    ...partAxes(axes()),
                    class: props.class,
                })}
            >
                {slots.default?.()}
            </view>
        )
        : undefined);
}, { name: 'Steps.Content' });

// ── Prev / Next ──

export type StepsTriggerProps =
    /** Accessible name — required when the content is not plain text. */
    & Define.Prop<'label', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

/**
 * Prev/Next: move to the nearest enabled step before/after the current one.
 * At a bound (or under a disabled root) the trigger is inert and stamps
 * `disabled`.
 */
const stepTrigger = (part: 'prev-trigger' | 'next-trigger', direction: -1 | 1, name: string) =>
    component<StepsTriggerProps>(({ props, slots, onMounted, onUnmounted }) => {
        const steps = useStepsContext();
        const axes = useVariantAxes();
        onUnmounted(joinAfterMount(onMounted, steps.joinWizard));
        const destination = (): string | undefined => steps.target(direction);
        const inert = (): boolean => steps.disabled() || destination() === undefined;
        const press = createPressFeedback({ isDisabled: inert, feel: steps.pressFeel() });
        return () => (
            <view
                {...partBag(anatomy, part, {
                    flags: { disabled: inert(), pressed: press.pressed() },
                    ...partAxes(axes()),
                    class: props.class,
                })}
                {...partA11y({ trait: 'button', label: props.label, disabled: inert() })}
                bindtap={() => {
                    const to = destination();
                    if (!steps.disabled() && to !== undefined) steps.select(to);
                }}
                {...press.handlers}
            >
                {slots.default?.()}
            </view>
        );
    }, { name });

const StepsPrevTrigger = stepTrigger('prev-trigger', -1, 'Steps.PrevTrigger');
const StepsNextTrigger = stepTrigger('next-trigger', 1, 'Steps.NextTrigger');

export const Steps = compound(StepsRoot, {
    Root: StepsRoot,
    Item: StepsItem,
    Indicator: StepsIndicator,
    Separator: StepsSeparator,
    Title: StepsTitle,
    Description: StepsDescription,
    Content: StepsContent,
    PrevTrigger: StepsPrevTrigger,
    NextTrigger: StepsNextTrigger,
});
