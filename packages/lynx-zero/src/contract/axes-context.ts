/**
 * Axis push-down — the runtime half of the no-combinator rule.
 *
 * The compiled lynx CSS narrows every axis/modifier rule with a flat
 * compound on the styled part itself (`.zx-tabs__tab.zx-a-size-xs`), never a
 * descendant selector — so every part must STAMP the axes its carrier
 * resolved. The carrier (the component's Root) provides its resolved axes
 * here; each part reads them into its `partBag` call. Nearest provider wins,
 * which reproduces the web `@scope` donut's proximity semantics under
 * same-scope nesting.
 *
 * The values provided are RESOLVED — explicit prop or the design system's
 * declared default — because this target emits no `:not([attr])` default
 * twins; an axis a recipe wires must always have a concrete class on screen.
 * (Resolution against manifest defaults arrives with the skin shell; until
 * then components pass the explicit props through.)
 */
import { defineInjectable, defineProvide } from '@sigx/lynx';
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
