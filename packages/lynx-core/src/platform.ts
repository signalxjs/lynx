/**
 * Platform — runtime platform checks + `select()`, sourced from the Lynx
 * `SystemInfo` global.
 *
 * Two tiers cooperate (see the package README):
 *
 *   • web vs. native is a BUILD-TIME split. `@sigx/lynx-plugin` injects the
 *     `__WEB__` / `__NATIVE__` defines per rspeedy environment, so on the web
 *     bundle `__WEB__` folds to `true` and the native-detection branch below
 *     is dead code the minifier drops. For tree-shaking your OWN code, branch
 *     on the raw `__WEB__` / `__NATIVE__` globals (or use `.web.tsx` /
 *     `.lynx.tsx` files) — `Platform.OS === 'web'` is a runtime convenience
 *     and does NOT tree-shake (a property read can't fold across modules),
 *     same as React Native.
 *
 *   • iOS vs. Android is a RUNTIME split — one native bundle serves both
 *     devices, so `SystemInfo.platform` is the only discriminator.
 */

// Build-time define from @sigx/lynx-plugin's DefinePlugin. Declared here so the
// module typechecks standalone; the `typeof` guard keeps it safe when the
// define is absent (Vitest / non-plugin builds), where it resolves at runtime.
declare const __WEB__: boolean | undefined;

/**
 * Shape of the Lynx `SystemInfo` global (only the fields we read are typed).
 * `platform` is `'Android' | 'iOS' | 'macOS' | 'windows' | 'headless'`.
 */
interface LynxSystemInfo {
    platform?: string;
    osVersion?: string;
    pixelRatio?: number;
    pixelWidth?: number;
    pixelHeight?: number;
    engineVersion?: string;
    runtimeType?: string;
}

// The Lynx runtime exposes SystemInfo as `lynx.SystemInfo` on the BG thread and
// installs `globalThis.SystemInfo` on the MT (lynx-runtime-main/entry-main.ts).
// `webkit` is an iOS-BG closure-arg with no Android equivalent. Declared
// ambient — they resolve through the runtime's lexical scope, not globalThis.
declare const lynx: { SystemInfo?: LynxSystemInfo } | undefined;
declare const webkit: unknown;

export type PlatformOS = 'ios' | 'android' | 'web';

/** Read SystemInfo from whichever thread-specific location holds it. */
function readSystemInfo(): LynxSystemInfo | undefined {
    try {
        const g = globalThis as { SystemInfo?: LynxSystemInfo };
        if (g.SystemInfo) return g.SystemInfo;
        if (typeof lynx !== 'undefined') return lynx?.SystemInfo;
    } catch {
        // SystemInfo not present (test env / SSR) — caller falls back.
    }
    return undefined;
}

/**
 * Runtime iOS-vs-Android detection for native bundles. Mirrors the layered
 * heuristic the dev-client streamer used: SystemInfo.platform first, then the
 * iOS-only `webkit` closure-arg, then a `navigator.userAgent` sniff. Defaults
 * to 'android' so a missing signal never crashes (the common case on the
 * Android BG runtime where SystemInfo is briefly absent is still Android).
 */
function detectNativeOS(): 'ios' | 'android' {
    try {
        const p = readSystemInfo()?.platform?.toLowerCase?.();
        if (p === 'ios') return 'ios';
        if (p === 'android') return 'android';
        if (typeof webkit !== 'undefined') return 'ios';
        if (typeof navigator !== 'undefined' && navigator?.userAgent) {
            const ua = navigator.userAgent.toLowerCase();
            if (ua.includes('android')) return 'android';
            if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'ios';
        }
    } catch {
        // best-effort
    }
    return 'android';
}

// `__WEB__` folds to a literal in real plugin builds, so on the web bundle this
// is `true` and `detectNativeOS()` (plus its SystemInfo/navigator refs) is
// dead-code-eliminated (the ternary's condition is constant, so the fallback
// branch is dropped). When the define is absent — Vitest / non-plugin embeds —
// fall back to reading `globalThis.__WEB__` so behavior stays deterministic
// without relying on a free identifier resolving through the global scope.
const isWeb =
    typeof __WEB__ !== 'undefined'
        ? __WEB__
        : (globalThis as { __WEB__?: boolean }).__WEB__ === true;

const info = readSystemInfo();

/** Logical (dp) min screen edge — used for the best-effort tablet heuristic. */
const minLogicalEdge =
    info && info.pixelWidth && info.pixelHeight
        ? Math.min(info.pixelWidth, info.pixelHeight) / (info.pixelRatio || 1)
        : 0;

/** Spec accepted by {@link Platform.select}. */
export interface PlatformSelectSpec<T> {
    ios?: T;
    android?: T;
    web?: T;
    /** Matches any native platform (ios/android), after the exact-OS key. */
    native?: T;
    /** Fallback when no platform key matches. */
    default?: T;
}

/**
 * Pick a value for the current platform. Precedence: exact OS key →
 * `native` (ios/android only) → `default`. Presence-based, not truthiness, so
 * an explicit `undefined` for the matching key is honored (mirrors RN).
 *
 * Provide `default` and the return type is `T`; omit it and it's `T | undefined`.
 */
export function select<T>(spec: PlatformSelectSpec<T> & { default: T }): T;
export function select<T>(spec: PlatformSelectSpec<T>): T | undefined;
export function select<T>(spec: PlatformSelectSpec<T>): T | undefined {
    if (Object.prototype.hasOwnProperty.call(spec, OS)) return spec[OS];
    if ((OS === 'ios' || OS === 'android') &&
        Object.prototype.hasOwnProperty.call(spec, 'native')) {
        return spec.native;
    }
    return spec.default;
}

/** The current platform: `'ios' | 'android' | 'web'`. */
export const OS: PlatformOS = isWeb ? 'web' : detectNativeOS();

/**
 * Platform information + `select()`. Values are read from `SystemInfo` once at
 * module load (which happens after the runtime populates it). Fields fall back
 * to neutral defaults under tests / SSR / non-Lynx hosts.
 */
export const Platform = {
    /** `'ios' | 'android' | 'web'`. */
    OS,
    /** OS version string, e.g. `'17.4'` / `'14'`. Empty when unknown. */
    Version: info?.osVersion ?? '',
    /** Best-effort iPad detection (iOS + logical min edge ≥ 600dp). */
    isPad: OS === 'ios' && minLogicalEdge >= 600,
    /** Device pixel ratio (physical px per dp). `1` when unknown. */
    pixelRatio: info?.pixelRatio ?? 1,
    /** Physical screen width in px. `0` when unknown. */
    pixelWidth: info?.pixelWidth ?? 0,
    /** Physical screen height in px. `0` when unknown. */
    pixelHeight: info?.pixelHeight ?? 0,
    /** Lynx engine version string. Empty when unknown. */
    engineVersion: info?.engineVersion ?? '',
    /** JS runtime, e.g. `'v8' | 'jsc' | 'quickjs'`. Empty when unknown. */
    runtimeType: info?.runtimeType ?? '',
    select,
} as const;
