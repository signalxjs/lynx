/**
 * Fieldset — a labelled group of form controls whose disabled, read-only
 * and invalid flags reach every control inside (zero #285).
 *
 * ```tsx
 * <Fieldset.Root disabled={!editing}>
 *     <Fieldset.Legend>Shipping</Fieldset.Legend>
 *     <NumberInput.Root min={1}>…</NumberInput.Root>
 * </Fieldset.Root>
 * ```
 *
 * Lynx has no native `<fieldset>`, so there is no platform half: the root is
 * a `view` and EVERYTHING travels by zero's `FieldsetContext`
 * (`provideFieldsetContext`) — the effective flags, the root's own prop OR
 * the nearest enclosing fieldset's, so nested fieldsets chain up. Controls
 * built on zero's `createFormControl` (NumberInput) read it directly.
 *
 * The Legend is a `text` part and the group's visible caption. It repeats
 * the root's `disabled` / `invalid` so a skin can dim or tint it without an
 * ancestor selector, and — the platform's legend exemption — re-provides the
 * OUTER fieldset's context to whatever it renders.
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { provideFieldsetContext, useFieldsetContext } from '@sigx/zero/behaviors/core';
import type { FieldsetContext } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';

const anatomy = anatomies.fieldset;

/** The Root's own context and the one it shadows — the Legend's view. */
interface FieldsetScope {
    self: FieldsetContext;
    outer: FieldsetContext;
}

const useFieldsetScope = defineInjectable<FieldsetScope | null>(() => null);

// ── Root ──

export type FieldsetRootProps =
    /** Disables every zero control inside. */
    & Define.Prop<'disabled', boolean, false>
    /** Every zero control inside is read-only. */
    & Define.Prop<'readonly', boolean, false>
    /** Marks the group and every zero control inside invalid. */
    & Define.Prop<'invalid', boolean, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const FieldsetRoot = component<FieldsetRootProps>(({ props, slots }) => {
    const outer = useFieldsetContext();
    const self: FieldsetContext = {
        inert: false,
        disabled: () => !!props.disabled || outer.disabled(),
        readonly: () => !!props.readonly || outer.readonly(),
        invalid: () => !!props.invalid || outer.invalid(),
    };
    provideFieldsetContext(self);
    const scope: FieldsetScope = { self, outer };
    defineProvide(useFieldsetScope, () => scope);
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color, size: props.size,
    }));

    return () => (
        <view
            {...partBag(anatomy, 'root', {
                flags: { disabled: self.disabled(), readonly: self.readonly(), invalid: self.invalid() },
                ...partAxes(axes()),
                class: props.class,
            })}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Fieldset.Root' });

// ── Legend ──

/** Render it as the Root's first child — the group's caption. */
export type FieldsetLegendProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

const FieldsetLegend = component<FieldsetLegendProps>(({ props, slots }) => {
    const scope = useFieldsetScope();
    const axes = useVariantAxes();
    // The platform's exemption: what sits in the legend answers to the
    // fieldsets OUTSIDE this one, not to it.
    if (scope) provideFieldsetContext(scope.outer);
    return () => (
        <text
            {...partBag(anatomy, 'legend', {
                flags: { disabled: scope?.self.disabled(), invalid: scope?.self.invalid() },
                ...partAxes(axes()),
                class: props.class,
            })}
        >
            {slots.default?.()}
        </text>
    );
}, { name: 'Fieldset.Legend' });

export const Fieldset = compound(FieldsetRoot, {
    Root: FieldsetRoot,
    Legend: FieldsetLegend,
});
