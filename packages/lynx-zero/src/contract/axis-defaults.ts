/**
 * Axis defaults — the design system's declared default axis values, the
 * missing half of the axis push-down contract.
 *
 * The compiled lynx CSS has no `:not([attr])` default twins: a rule keyed on
 * an axis (`.zx-button__root.zx-a-variant-solid`) matches only when the
 * concrete class is on screen. So an axis the recipe wires must always
 * resolve to a value — the explicit prop, or the default the design system's
 * manifest declares (`components.<scope>.defaults`). The skin shell carries
 * those defaults across at load, right beside `registerTheme`; lynx-zero
 * itself never imports a design system.
 *
 * Registered before first render (the shell package's import side effect),
 * like the theme and text-ramp registries — a late registration only reaches
 * parts on their next re-render.
 */
import type { VariantAxes } from './axes-context.js';

/** One scope's axis defaults: axis name → default value (`{ color: 'primary' }`). */
export type AxisDefaults = Record<string, string>;

let defaults: Record<string, AxisDefaults> = {};

function sameDefaults(a: AxisDefaults, b: AxisDefaults): boolean {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

/**
 * Register a design system's declared axis defaults, keyed by anatomy scope.
 * Re-registering a scope replaces it; identical values (the HMR case) are
 * silent, different values warn — same semantics as `registerTheme`.
 */
export function registerAxisDefaults(byScope: Record<string, AxisDefaults>): void {
    for (const [scope, values] of Object.entries(byScope)) {
        const existing = defaults[scope];
        if (existing && !sameDefaults(existing, values)) {
            console.warn(
                `[lynx-zero] axis defaults for "${scope}" already registered with different values — re-registering over them.`,
            );
        }
        defaults[scope] = { ...values };
    }
}

/** @internal — test seam. */
export function clearAxisDefaults(): void {
    defaults = {};
}

const NAMED_AXES = ['color', 'size', 'variant'] as const;

/**
 * Fill a carrier's unset axes from the scope's registered defaults. Explicit
 * values always win, `mods` pass through untouched, and a scope with nothing
 * registered resolves to the input unchanged — stamping nothing, exactly the
 * pre-registration behavior. A default for an axis outside color/size/variant
 * lands in `axes`, so `partAxes` stamps it like any custom axis.
 */
export function resolveVariantAxes(scope: string, axes: VariantAxes): VariantAxes {
    const d = defaults[scope];
    if (!d) return axes;
    const resolved: VariantAxes = { ...axes };
    for (const [axis, value] of Object.entries(d)) {
        if ((NAMED_AXES as readonly string[]).includes(axis)) {
            resolved[axis as (typeof NAMED_AXES)[number]] ??= value;
        } else if (resolved.axes?.[axis] === undefined) {
            resolved.axes = { ...resolved.axes, [axis]: value };
        }
    }
    return resolved;
}
