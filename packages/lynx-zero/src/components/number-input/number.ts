/**
 * Pure number math for NumberInput — a port of `@sigx/zero`'s
 * `components/number-input/number.ts` (not on zero's published surface), so
 * both platforms step, snap and clamp on the identical grid.
 *
 * The float trap this file exists for: `0.1 + 0.2 → 0.30000000000000004`,
 * so repeated stepping by a decimal step accumulates noise unless every
 * result is rounded back to the precision the inputs actually have.
 */

/** Decimal places of a number as written (`0.25 → 2`, `10 → 0`). */
export function precisionOf(n: number): number {
    const s = String(n);
    const e = s.indexOf('e-');
    // 1e-7 stringifies exponentially; its precision is the exponent.
    if (e !== -1) return parseInt(s.slice(e + 2), 10);
    const dot = s.indexOf('.');
    return dot === -1 ? 0 : s.length - dot - 1;
}

export function clamp(v: number, min?: number, max?: number): number {
    if (min !== undefined && v < min) return min;
    if (max !== undefined && v > max) return max;
    return v;
}

/**
 * Snap to the step grid anchored at `min` (APG: with min 1 and step 2 the
 * valid values are 1, 3, 5…). Without a min the grid anchors at 0. The
 * result is rounded to the combined precision of step and anchor.
 */
export function snapToStep(v: number, step: number, min?: number): number {
    const base = min ?? 0;
    const precision = Math.max(precisionOf(step), precisionOf(base));
    // The quotient carries its own float noise (0.35/0.1 is
    // 3.4999999999999996) — rounding it to 10 decimals first restores the
    // intended half-up behavior.
    const steps = Math.round(Number(((v - base) / step).toFixed(10)));
    return Number((steps * step + base).toFixed(precision));
}

/**
 * Step `v` by `amount` (default one `step`) in `direction`, on the grid
 * `snapToStep` uses. An OFF-grid value (a typed 5 on step 2) first lands on
 * the neighbouring grid value in the direction of travel (up → 6, down →
 * 4), and that landing counts as the first step of the amount.
 */
export function stepToward(v: number, direction: 1 | -1, step: number, min?: number, amount: number = step): number {
    const base = min ?? 0;
    const precision = Math.max(precisionOf(step), precisionOf(base));
    const q = Number(((v - base) / step).toFixed(10));
    if (Number.isInteger(q)) return snapToStep(v + direction * amount, step, min);
    const landed = Number(((direction > 0 ? Math.ceil(q) : Math.floor(q)) * step + base).toFixed(precision));
    return snapToStep(landed + direction * Math.max(0, amount - step), step, min);
}

// Decimal syntax only — bare Number() would also accept 0x10/0b10/0o10,
// which is not what "type a number" means in a form field.
const DECIMAL_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** zero's default parse: lenient decimal, `null` for "not a number". */
export function parseDecimal(text: string): number | null {
    const t = text.trim();
    if (!DECIMAL_RE.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}
