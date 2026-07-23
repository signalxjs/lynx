/**
 * Detent model — how a sheet declares its resting heights.
 *
 * Both sheet frontends (the standalone `<BottomSheet>` and lynx-navigation's
 * `presentation: 'sheet'`) resolve their config through this one module, so
 * "px vs fraction-of-screen" stops being two different APIs. Resolution runs
 * on the background thread at render time and produces plain ascending px
 * values; the resolved array is what crosses to the main thread (via the
 * engine's geometry sync), never the specs themselves.
 */

/**
 * One declared resting height. Ascending after resolution; the first
 * (lowest) resolved detent is the sheet's floor.
 *
 * - `number` / `{ px }` — visible height in px.
 * - `{ fraction }` — share of screen height, `(0, 1]`.
 * - `{ keyboard }` — the height at which the sheet's floor content sits
 *   exactly on top of the soft keyboard: resolved as
 *   `floor + keyboardPx + bottomInset` from the environment, falling back
 *   to `floor + fallbackPx` while no keyboard height has been observed
 *   yet. The env's `keyboardPx` must come from a BG-reactive keyboard
 *   source (e.g. the max observed `useKeyboardLift()` value) — never from
 *   reading a MT-written SharedValue's BG side, which stays at its seed.
 *   The bottom inset is added back here because keyboard *lift* values are
 *   inset-discounted while the sheet itself reaches the true screen
 *   bottom.
 */
export type DetentSpec =
    | number
    | { px: number }
    | { fraction: number }
    | { keyboard: true; fallbackPx?: number };

/** Environment a `DetentSpec[]` resolves against. */
export interface DetentEnv {
    /** Full screen height in px. */
    screenH: number;
    /**
     * Px reserved above the fully-open sheet (e.g. top safe-area inset +
     * a header the sheet must never slide under). Every resolved detent is
     * clamped to `screenH - topOffset`.
     */
    topOffset?: number;
    /** Bottom safe-area inset — added back onto keyboard detents. */
    bottomInset?: number;
    /**
     * Remembered keyboard lift in px (inset-discounted, as reported by
     * keyboard lift APIs). `0` = no keyboard observed yet.
     */
    keyboardPx?: number;
}

/** Keyboard-detent fallback while no keyboard has been observed yet. */
export const DEFAULT_KEYBOARD_FALLBACK_PX = 320;

/** Default detent when a sheet declares nothing valid: half the screen. */
export const DEFAULT_DETENT_FRACTION = 0.5;

/**
 * Resolve declared detents to ascending, deduplicated px heights.
 *
 * Invalid specs are dropped, not reinterpreted (a fraction outside
 * `(0, 1]` or a non-positive px is a config error). Every resolved value
 * is rounded and clamped to `[1, screenH - topOffset]` — clamping can
 * collapse two declared detents into one, which dedup then removes.
 * When nothing valid remains, falls back to `[fraction: 0.5]`.
 */
export function resolveDetents(
    specs: readonly DetentSpec[] | undefined,
    env: DetentEnv,
): number[] {
    const topOffset = env.topOffset ?? 0;
    const cap = Math.max(1, Math.round(env.screenH - topOffset));

    // Pass 1 — keyboard-independent specs. Their minimum is the floor the
    // keyboard detent rides on (a keyboard detent as the only/lowest spec
    // rides on a zero floor).
    const fixed: number[] = [];
    for (const spec of specs ?? []) {
        if (typeof spec === 'number') {
            if (spec > 0) fixed.push(spec);
        } else if ('px' in spec) {
            if (spec.px > 0) fixed.push(spec.px);
        } else if ('fraction' in spec) {
            if (spec.fraction > 0 && spec.fraction <= 1) {
                fixed.push(spec.fraction * env.screenH);
            }
        }
    }
    const floorBase = fixed.length > 0 ? Math.min(...fixed) : 0;

    // Pass 2 — keyboard specs ride on the floor.
    const resolved = [...fixed];
    for (const spec of specs ?? []) {
        if (typeof spec === 'object' && 'keyboard' in spec) {
            const kb =
                (env.keyboardPx ?? 0) > 0
                    ? (env.keyboardPx ?? 0) + (env.bottomInset ?? 0)
                    : (spec.fallbackPx ?? DEFAULT_KEYBOARD_FALLBACK_PX);
            resolved.push(floorBase + kb);
        }
    }

    const cleaned = resolved
        .map((v) => Math.min(cap, Math.max(1, Math.round(v))))
        .sort((a, b) => a - b)
        .filter((v, i, arr) => i === 0 || v !== arr[i - 1]);

    if (cleaned.length > 0) return cleaned;
    return [Math.min(cap, Math.max(1, Math.round(DEFAULT_DETENT_FRACTION * env.screenH)))];
}
