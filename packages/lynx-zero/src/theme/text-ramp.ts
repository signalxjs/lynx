/**
 * The scalable text ramp — the runtime half of the `--text-*` /
 * `--text-fixed-*` split the zero contract draws.
 *
 * The compiled skin declares BOTH ramps as literals on `.zx-root`: `--text-*`
 * (what in-app text reads) and `--text-fixed-*` (control chrome the scaler
 * must never touch). When the in-app font scale is 1 the stylesheet is
 * already correct; at any other scale the provider re-emits `--text-*` as
 * scaled literal px INLINE on its host view — inline custom properties beat
 * the class declaration, and `--text-fixed-*` stays untouched by
 * construction because only the scalable ramp is re-emitted.
 *
 * The unscaled values come from the design-system package: its lynx side
 * module registers them at load, right beside `registerThemes` — the same
 * values its compiled `tokens.css` carries, so what the scaler multiplies is
 * exactly what the stylesheet declared. Only px entries scale (the engine's
 * arithmetic over other units is not proven); a non-px entry is re-emitted
 * verbatim.
 */

let ramp: Record<string, string> = {};

/** Register the design system's unscaled `--text-*` ramp (key → CSS value). */
export function registerTextRamp(values: Record<string, string>): void {
    ramp = { ...values };
}

/** @internal — test seam. */
export function clearTextRamp(): void {
    ramp = {};
}

const PX = /^\s*(\d+(?:\.\d+)?)px\s*$/;

/**
 * The `--text-*` ramp at `fontScale`, as literal declarations. Empty when no
 * ramp is registered or the scale is 1 — at 1 the stylesheet already says
 * exactly this, and emitting nothing keeps the host view's inline style
 * clean.
 */
export function textRampVars(fontScale: number): Record<string, string> {
    if (fontScale === 1) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(ramp)) {
        const px = PX.exec(value);
        out[`--text-${key}`] = px ? `${Math.round(Number(px[1]) * fontScale)}px` : value;
    }
    return out;
}
