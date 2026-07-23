import { computed, signal, type Computed } from '@sigx/reactivity';

/**
 * OS font scale — the effective text-size multiplier the engine applies to
 * every font-relevant CSS length (#766).
 *
 * Lives in core (not a feature package) because core owns the native side:
 * `FontScalePublisher` (iOS/Android) seeds `lynx.__globalProps.fontScale`
 * before first paint and pushes runtime changes via
 * `LynxView.updateFontScale()`, and the ENGINE itself emits the
 * `onFontScaleChanged` global event on every change — so the reactive read
 * belongs next to the publisher, reachable without pulling in
 * `@sigx/lynx-appearance` (which re-exports this surface).
 *
 * The engine scales plain `<text>`/`font-size` automatically; use these reads
 * to adapt AROUND larger text (swap layouts, grow custom-drawn text like
 * `@sigx/lynx-markdown`'s editor, size icons).
 */

/**
 * Global event fired by the Lynx ENGINE (not a sigx publisher) whenever the
 * host calls `LynxView.updateFontScale()`. Payload: `{ scale }` — the new
 * effective scale. Engine-owned name
 * (`core/renderer/template_assembler.cc` upstream).
 */
export const FONT_SCALE_EVENT = 'onFontScaleChanged';

/**
 * Key under `lynx.__globalProps` where the native `FontScalePublisher`
 * writes the font-scale map before MT first paint.
 */
export const FONT_SCALE_GLOBAL_KEY = 'fontScale';

/** Shape of `lynx.__globalProps.fontScale` as written by the publishers. */
export interface RawFontScaleProps {
    /** Policy-clamped effective scale — what the engine applies. */
    scale?: number;
    /** Raw, unclamped OS value (Dynamic Type / Configuration.fontScale). */
    os?: number;
}

interface GlobalEventEmitterLike {
    addListener: (name: string, fn: (...a: unknown[]) => void) => void;
    removeListener: (name: string, fn: (...a: unknown[]) => void) => void;
}

interface LynxLike {
    getJSModule?: (name: string) => GlobalEventEmitterLike | undefined;
    __globalProps?: { [k: string]: unknown };
}

declare const lynx: unknown | undefined;

/**
 * Round to 3 decimals — Android's Float-backed scale widens with binary
 * noise (1.15f arrives as 1.14999997…); the publishers write 3-decimal
 * values, so this keeps the event path consistent with `__globalProps`.
 */
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * Synchronously read the OS font scale from `lynx.__globalProps`. Returns
 * `null` when the publisher hasn't populated yet (early cold start) or when
 * running outside a Lynx host (web preview, SSR, tests). Callers should
 * treat `null` as "unknown — assume 1".
 *
 * `scale` is the policy-clamped effective value the engine applies to
 * font-size/line-height; `os` is the raw system setting (equal to `scale`
 * unless the app's `fontScale.min/max` config clamped it).
 *
 * Safe on both BG and MT threads — `__globalProps` is mirrored across both.
 * Not reactive: a read taken during the render triggered by
 * `onFontScaleChanged` can see the previous `os` (the globalProps mirror
 * updates independently of the event). Prefer {@link useFontScale} for the
 * live effective value; treat `os` as informational.
 */
export function readGlobalFontScale(): { scale: number; os: number } | null {
    const lynxObj: LynxLike | undefined = typeof lynx !== 'undefined'
        ? (lynx as LynxLike)
        : undefined;
    const raw = lynxObj?.__globalProps?.[FONT_SCALE_GLOBAL_KEY] as RawFontScaleProps | undefined;
    if (!raw || typeof raw !== 'object') return null;
    const scale = raw.scale;
    if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return null;
    const os = typeof raw.os === 'number' && Number.isFinite(raw.os) && raw.os > 0 ? raw.os : scale;
    return { scale, os };
}

// The single source of truth. Seeded lazily on first reactive read (the
// publisher writes __globalProps before first paint, so the first read is
// correct on cold start); updated by the engine's onFontScaleChanged event.
const state = signal({ scale: 1 });
let emitterWired = false;
let seeded = false;
let scaleComputed: Computed<number> | undefined;

/**
 * Wire the GlobalEventEmitter listener + globalProps seed, lazily. The latch
 * is only set on SUCCESS (same pattern as core's app-state): if the first
 * call races runtime init and the emitter isn't reachable yet, a later call
 * retries. Off-device (web preview, SSR, tests) neither ever succeeds — the
 * signal stays at `1`, the correct degradation.
 */
const ensureWired = (): void => {
    if (!seeded) {
        const initial = readGlobalFontScale();
        if (initial) {
            seeded = true;
            state.scale = round3(initial.scale);
        }
    }
    if (!emitterWired) {
        try {
            const emitter = typeof lynx !== 'undefined'
                ? (lynx as LynxLike).getJSModule?.('GlobalEventEmitter')
                : undefined;
            if (emitter) {
                emitter.addListener(FONT_SCALE_EVENT, (payload: unknown) => {
                    const v = typeof payload === 'number'
                        ? payload
                        : (payload as { scale?: unknown } | undefined)?.scale;
                    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
                        state.scale = round3(v);   // signal dedups
                    }
                });
                emitterWired = true;
            }
        } catch {
            // getJSModule threw — retry on the next call.
        }
    }
};

/**
 * BG-side reactive read of the effective OS font scale (`1` = default).
 * Returns a stable `Computed<number>` — read `.value` in render/effects and
 * the component re-renders when the user changes the system text size.
 */
export function useFontScale(): Computed<number> {
    ensureWired();
    if (!scaleComputed) {
        scaleComputed = computed(() => state.scale);
    }
    return scaleComputed;
}

/**
 * MT-thread synchronous read of the effective OS font scale. For use inside
 * `'main thread'`-marked worklet bodies. Reads `lynx.__globalProps` directly —
 * no subscription, callers re-evaluate per worklet invocation.
 *
 * Returns `1` when the publisher hasn't populated yet (cold start before
 * first publish, or non-Lynx hosts).
 */
export function useFontScaleMT(): number {
    return readGlobalFontScale()?.scale ?? 1;
}
