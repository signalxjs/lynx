/**
 * `partBag` — the render seam of every lynx-zero component, the counterpart
 * of zero's web `bag()` pattern. One part descriptor yields BOTH halves of
 * the anatomy contract on this platform:
 *
 * - the **class list**, composed exclusively with `@sigx/zero/contract`'s
 *   grammar helpers (`zx-<scope>__<part>` + state/flag/axis/mod/orientation/
 *   placement compounds) — the only thing lynx's style engine can select on,
 *   and exactly what `@sigx/zero-kit`'s lynx target emits selectors for;
 * - the **`data-*` attributes**, computed with zero's own `dataAttr`/
 *   `stateAttr`/`variantAttrs` — they render fine on lynx (they reach
 *   `__SetAttribute`) and stay the machine-readable anatomy for tests and
 *   tooling. Because the classes derive from the same inputs, a passing
 *   anatomy walk transitively validates the class list.
 *
 * Axis push-down: the emitted CSS narrows axis rules with a flat compound on
 * the styled part itself, so EVERY part must stamp its axis/modifier classes
 * — the component layer passes the carrier's resolved axes down (context),
 * and `partBag` stamps whatever it is handed. There is no default-twin
 * selector on this target: pass the resolved value (explicit or default),
 * not `undefined`, wherever a recipe wires the axis.
 */
import type { Anatomy } from '@sigx/zero/contract/core';
import {
    axisClass,
    dataAttr,
    flagClass,
    modClass,
    orientationClass,
    partClass,
    placementClass,
    stateClass,
    variantAttrs,
} from '@sigx/zero/contract/core';

/** The flat, spreadable props one rendered part carries. */
export interface LynxPartProps {
    class: string;
    'data-scope': string;
    'data-part': string;
    'data-state'?: string;
    'data-orientation'?: string;
    'data-placement'?: string;
    [attr: string]: unknown;
}

export interface PartBagOptions {
    /** One machine state from the part's closed set (`open`, `checked`, …). */
    state?: string;
    /**
     * Boolean flags from the contract vocabulary (`disabled`, `pressed`,
     * `focus-visible`, …). `false`/`undefined` mean absent — no class, no
     * attribute — matching the presence-only attribute contract.
     */
    flags?: Record<string, boolean | undefined>;
    /** Contract axes: color/size/variant plus any DS-declared custom axis. */
    axes?: {
        color?: string;
        size?: string;
        variant?: string;
        [axis: string]: string | undefined;
    };
    /** Presence-only design-system modifiers (`block`, `icon-only`, …). */
    mods?: Record<string, boolean | undefined>;
    orientation?: 'horizontal' | 'vertical';
    placement?: string;
    /** Consumer classes, appended last so they can override by order. */
    class?: string;
}

/**
 * Build the spreadable props for one rendered part. Throws exactly where
 * zero's `variantAttrs` throws (reserved/malformed axis names) — the same
 * inputs feed both halves, so the guard runs once and covers both.
 */
export function partBag(anatomy: Anatomy, part: string, options: PartBagOptions = {}): LynxPartProps {
    const spec = anatomy.parts[part];
    if (!spec) {
        const known = Object.keys(anatomy.parts).join(', ');
        throw new Error(`[@sigx/lynx-zero] "${anatomy.scope}" has no part "${part}" (known: ${known})`);
    }

    const { color, size, variant, ...customAxes } = options.axes ?? {};
    // One pass through zero's guard covers reserved names and the kebab-case
    // grammar for axes AND mods; its output is also the data-attr half.
    // Unset named axes come back as `undefined`-valued keys (spread-friendly
    // for JSX, where undefined removes the attribute) — dropped here so the
    // BAG carries only what renders.
    const attrs = Object.fromEntries(
        Object.entries(variantAttrs({ color, size, variant, axes: customAxes, mods: options.mods }))
            .filter(([, value]) => value !== undefined),
    );

    const classes: string[] = [partClass(anatomy.scope, part)];
    if (options.state) classes.push(stateClass(options.state));
    for (const [flag, on] of Object.entries(options.flags ?? {})) {
        if (on) classes.push(flagClass(flag));
    }
    for (const [axis, value] of Object.entries({ color, size, variant, ...customAxes })) {
        if (value !== undefined) classes.push(axisClass(axis, value));
    }
    for (const [name, on] of Object.entries(options.mods ?? {})) {
        if (on) classes.push(modClass(name));
    }
    if (options.orientation) classes.push(orientationClass(options.orientation));
    if (options.placement) classes.push(placementClass(options.placement));
    if (options.class) classes.push(options.class);

    const bag: LynxPartProps = {
        class: classes.join(' '),
        'data-scope': anatomy.scope,
        'data-part': part,
        ...attrs,
    };
    if (options.state) bag['data-state'] = options.state;
    if (options.orientation) bag['data-orientation'] = options.orientation;
    if (options.placement) bag['data-placement'] = options.placement;
    for (const [flag, on] of Object.entries(options.flags ?? {})) {
        const value = dataAttr(on);
        if (value !== undefined) bag[`data-${flag}`] = value;
    }
    return bag;
}
