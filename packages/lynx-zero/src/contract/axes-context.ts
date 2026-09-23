/**
 * Axis push-down — the runtime half of the no-combinator rule.
 *
 * The compiled lynx CSS narrows every axis/modifier rule with a flat
 * compound on the styled part itself (`.zx-tabs__tab.zx-a-size-xs`), never a
 * descendant selector — so every part must STAMP the axes its carrier
 * resolved. The carrier (the component's Root) provides its resolved axes
 * here; each part reads them into its `partBag` call. Nearest provider wins,
 * which reproduces the web `@scope` donut's proximity semantics under
 * same-scope nesting — and a part whose anatomy declares it `carries` an
 * axis is a provider too (`provideCarriedAxes`).
 *
 * The values provided are RESOLVED — explicit prop or the design system's
 * declared default — because this target emits no `:not([attr])` default
 * twins; an axis a recipe wires must always have a concrete class on screen.
 * Carriers resolve with `resolveVariantAxes` (axis-defaults.ts) against the
 * defaults the skin shell registers from its manifest at load.
 */
import { defineInjectable, defineProvide } from '@sigx/lynx';
import type { Anatomy, CarriedAxis } from '@sigx/zero/contract/core';
import type { PartBagOptions } from './part.js';

export interface VariantAxes {
    color?: string;
    size?: string;
    variant?: string;
    axes?: Record<string, string | undefined>;
    mods?: Record<string, boolean | undefined>;
}

const useVariantAxesInjectable = defineInjectable<() => VariantAxes>(() => () => ({}));

/** Read the nearest carrier's resolved axes (empty outside any carrier). */
export function useVariantAxes(): () => VariantAxes {
    return useVariantAxesInjectable();
}

/**
 * Provide this scope's resolved axes to every part below. Pass a READER so
 * prop changes stay reactive — the parts re-render with the carrier.
 */
export function provideVariantAxes(read: () => VariantAxes): void {
    defineProvide(useVariantAxesInjectable, () => read);
}

/**
 * A part that RE-CARRIES an axis (`PartSpec.carries`, zero#94) is a provider
 * of that axis for itself and every part below it — the lynx spelling of the
 * web compiler's "nearest carrier wins". With its own value (`own()`) the
 * part stamps that value; without one it passes the inherited value (the
 * carrier's, or a nearer provider's) straight through. Axes the anatomy does
 * not declare the part carries are never taken from `own()`: the contract
 * only lets a part re-carry what its anatomy promises.
 *
 * Call it in the part's setup, in place of `useVariantAxes()`; it returns
 * the part's own effective axes reader, and provides that same reader to the
 * parts below.
 */
export function provideCarriedAxes(
    anatomy: Anatomy,
    part: string,
    own: () => Partial<Record<CarriedAxis, string | undefined>>,
): () => VariantAxes {
    const spec = anatomy.parts[part];
    if (!spec) {
        const known = Object.keys(anatomy.parts).join(', ');
        throw new Error(`[@sigx/lynx-zero] "${anatomy.scope}" has no part "${part}" (known: ${known})`);
    }
    const carries: readonly CarriedAxis[] = spec.carries ?? [];
    const inherited = useVariantAxes();
    const read = (): VariantAxes => {
        const base = inherited();
        if (carries.length === 0) return base;
        const mine = own();
        let effective: VariantAxes | null = null;
        for (const axis of carries) {
            const value = mine[axis];
            if (value === undefined) continue;
            effective ??= { ...base };
            effective[axis] = value;
        }
        return effective ?? base;
    };
    provideVariantAxes(read);
    return read;
}

/**
 * The `partBag`-ready slice of a carrier's axes — flattens the named axes
 * with the custom ones and carries the modifiers, so a part stamps
 * everything with one spread: `partBag(anatomy, 'tab', { …, ...partAxes(axes()) })`.
 */
export function partAxes(a: VariantAxes): Pick<PartBagOptions, 'axes' | 'mods'> {
    return {
        axes: { color: a.color, size: a.size, variant: a.variant, ...a.axes },
        mods: a.mods,
    };
}
