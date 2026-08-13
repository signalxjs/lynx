/**
 * Responsive prop values — a per-breakpoint object accepted anywhere a layout
 * primitive takes a plain value (#1013).
 *
 * ```tsx
 * <Col padding={{ initial: 16, expanded: 32 }} gap={{ initial: 8, large: 16 }} />
 * ```
 *
 * Design-system-neutral by construction: plain JS resolution off core's
 * `useWidthClass()`, with no dependency on Tailwind, class names or any CSS
 * pipeline. It behaves identically under daisyui, heroui, and under no design
 * system at all.
 *
 * It also has to be JS rather than CSS: the layout primitives emit **inline
 * styles**, and a stylesheet `@media` rule can never override an inline style.
 *
 * Keys are the `WidthClass` tokens from core, with `initial` naming the
 * `compact` base — one vocabulary across both packages. Resolution is
 * **mobile-first**: a key applies at its breakpoint *and every wider one*, so
 * `{ initial: 16, expanded: 32 }` is 16 on phones and small tablets and 32 from
 * 840dp up. Width only; branch on height explicitly with `useHeightAtLeast()`.
 *
 * There is deliberately no `useResponsive()` hook. It would have to build a
 * `computed()` per call site, and `computed()` has no disposer while a signal's
 * subscriber set holds strong references — so every mount would leak one. Read
 * the singleton class and resolve inline instead, which is also less
 * indirection:
 *
 * ```tsx
 * const cls = useWidthClass();                                  // setup
 * return () => <Grid columns={resolveResponsive(cols, cls.value) ?? 1} />;
 * ```
 */
import { createLogger, type WidthClass } from '@sigx/lynx';

const log = createLogger('lynx-zero');

/** A plain value, or one value per breakpoint. */
export type Responsive<T> = T | ResponsiveObject<T>;

/** The per-breakpoint form. `initial` is the `compact` base case. */
export interface ResponsiveObject<T> {
    initial?: T;
    medium?: T;
    expanded?: T;
    large?: T;
    xlarge?: T;
}

/**
 * Widest-first, so the cascade is a plain scan: from the active class, take the
 * first key at or below it that is defined.
 */
const CASCADE = ['xlarge', 'large', 'expanded', 'medium', 'initial'] as const;

/** Where each width class starts scanning {@link CASCADE}. */
const CASCADE_START: Record<WidthClass, number> = {
    xlarge: 0,
    large: 1,
    expanded: 2,
    medium: 3,
    compact: 4,
};

const BREAKPOINT_KEYS: ReadonlySet<string> = new Set(CASCADE);

/**
 * Is this the per-breakpoint object form?
 *
 * The check matters because `SpacingValue` is *itself* an object
 * (`{ x, y, top, right, bottom, left }`), so `Responsive<SpacingValue>` is a
 * union of two object shapes. They separate cleanly because the key sets are
 * disjoint — but a mixed object (`{ initial: 4, top: 8 }`) is a bug, and
 * silently picking either reading would drop half the author's intent. Warn and
 * treat it as a plain value, the reading that keeps `top` working.
 */
function isResponsiveObject<T>(value: Responsive<T>): value is ResponsiveObject<T> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const keys = Object.keys(value);
    if (keys.length === 0) return false;
    const stray = keys.filter((k) => !BREAKPOINT_KEYS.has(k));
    if (stray.length === keys.length) return false;
    if (stray.length > 0) {
        log.warn(
            `responsive value mixes breakpoint keys with plain keys (${stray.join(', ')}); `
            + 'treating it as a plain value. Nest it instead: '
            + '{ initial: { … }, expanded: { … } }.',
        );
        return false;
    }
    return true;
}

/**
 * Resolve a responsive value against a width class.
 *
 * Returns `undefined` when the object defines nothing at or below `cls`, so
 * `{ expanded: 32 }` contributes no padding on a phone rather than forcing a
 * zero — callers treat that exactly like an omitted prop.
 */
export function resolveResponsive<T>(
    value: Responsive<T> | undefined,
    cls: WidthClass,
): T | undefined {
    if (value === undefined) return undefined;
    if (!isResponsiveObject(value)) return value;
    for (let i = CASCADE_START[cls]; i < CASCADE.length; i++) {
        const v = value[CASCADE[i]];
        if (v !== undefined) return v;
    }
    return undefined;
}
