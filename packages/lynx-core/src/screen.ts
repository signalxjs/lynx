import { computed, signal, type Computed } from '@sigx/reactivity';
import { Platform } from './platform.js';
import { isNativeEventsAvailable, subscribeNative } from './events.js';

/**
 * Live screen metrics — the logical size and orientation of the surface the
 * app is laid out in, kept current across rotation, split-screen and foldable
 * unfold (#856).
 *
 * Lives in core (not a feature package) because core owns the native side:
 * `ScreenMetricsPublisher` (iOS/Android) seeds `lynx.__globalProps.screen`
 * before MT first paint and republishes on every viewport change, so the
 * reactive read belongs next to the publisher — reachable without pulling in
 * a feature package, exactly like {@link useFontScale}.
 *
 * This is also the BG-safe screen-size accessor (#333): `lynx.SystemInfo` is
 * empty on the background thread, but `__globalProps` is mirrored onto both
 * threads, so {@link readGlobalScreen} works everywhere.
 *
 * `Platform.pixelWidth` / `pixelHeight` remain a load-time snapshot by design
 * (they describe the device); use these reads whenever the value feeds layout.
 */

/**
 * Global event fired by the native `ScreenMetricsPublisher` (and the web host)
 * after every republish. Payload: the same map written to
 * `__globalProps.screen`.
 */
export const SCREEN_EVENT = 'screenChanged';

/**
 * Key under `lynx.__globalProps` where the native publishers write the screen
 * map before MT first paint.
 */
export const SCREEN_GLOBAL_KEY = 'screen';

/**
 * Fine-grained interface orientation, as reported by the platform.
 *
 * `landscape-left` / `landscape-right` name the direction the device was
 * rotated (matching iOS's `UIInterfaceOrientationLandscapeLeft/Right` and
 * Android's `Surface.ROTATION_90/270`). Most layout code wants the coarse
 * portrait/landscape split — see {@link useOrientation}.
 */
export type ScreenOrientation =
    | 'portrait'
    | 'portrait-upside-down'
    | 'landscape-left'
    | 'landscape-right';

/** The coarse split most layout code branches on. */
export type CoarseOrientation = 'portrait' | 'landscape';

/** Live screen metrics. Lengths are logical (dp on Android, pt on iOS). */
export interface ScreenMetrics {
    /** Logical viewport width. */
    width: number;
    /** Logical viewport height. */
    height: number;
    /** Logical→physical multiplier (`density` / `UIScreen.scale`). */
    scale: number;
    /** Fine-grained interface orientation. */
    orientation: ScreenOrientation;
    /** `true` for either landscape orientation — the common branch. */
    isLandscape: boolean;
}

/** Shape of `lynx.__globalProps.screen` as written by the publishers. */
export interface RawScreenProps {
    width?: number;
    height?: number;
    scale?: number;
    orientation?: string;
}

interface LynxLike {
    __globalProps?: { [k: string]: unknown };
}

declare const lynx: unknown | undefined;

/**
 * Last-resort dimensions for tests / SSR / non-Lynx hosts, matching the
 * typical-phone fallback `@sigx/lynx-navigation` has always used so migrating
 * consumers keeps its exact off-device behavior.
 */
const FALLBACK_WIDTH = 400;
const FALLBACK_HEIGHT = 800;

const ORIENTATIONS: readonly string[] = [
    'portrait',
    'portrait-upside-down',
    'landscape-left',
    'landscape-right',
];

const isLandscapeOrientation = (o: ScreenOrientation): boolean =>
    o === 'landscape-left' || o === 'landscape-right';

/** Positive, finite numbers only — a publisher mid-teardown can emit garbage. */
const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;

/**
 * Payload guard for the `screenChanged` channel. Deliberately the same
 * admission test {@link parseScreen} applies (usable width + height), so a
 * garbage publish during teardown is dropped at the subscription boundary
 * rather than reaching the signal.
 */
const isRawScreen = (raw: unknown): raw is RawScreenProps =>
    !!raw && typeof raw === 'object'
    && num((raw as RawScreenProps).width) !== undefined
    && num((raw as RawScreenProps).height) !== undefined;

/**
 * Validate one publisher payload (both channels carry the same map). Returns
 * `null` for anything unusable so a garbage publish during teardown can't
 * corrupt the signal.
 */
function parseScreen(raw: unknown, fallbackScale: number): ScreenMetrics | null {
    if (!raw || typeof raw !== 'object') return null;
    const props = raw as RawScreenProps;
    const width = num(props.width);
    const height = num(props.height);
    if (width === undefined || height === undefined) return null;
    const orientation = (
        typeof props.orientation === 'string' && ORIENTATIONS.includes(props.orientation)
            ? props.orientation
            // Derive rather than drop the whole map: a host that publishes
            // sizes but not an orientation string still gets the coarse split
            // right, which is what layout branches on.
            : width > height ? 'landscape-left' : 'portrait'
    ) as ScreenOrientation;
    return {
        width,
        height,
        scale: num(props.scale) ?? fallbackScale,
        orientation,
        isLandscape: isLandscapeOrientation(orientation),
    };
}

/**
 * Synchronously read the screen map from `lynx.__globalProps`. Returns `null`
 * when the publisher hasn't populated yet (early cold start) or when running
 * outside a Lynx host (web preview, SSR, tests) — callers that just want a
 * usable number should prefer {@link useScreen} / {@link useScreenMT}, which
 * fall back rather than returning `null`.
 *
 * Safe on both BG and MT threads: `__globalProps` is mirrored across both,
 * which is what makes this the BG-safe screen-size accessor (#333).
 */
export function readGlobalScreen(): ScreenMetrics | null {
    const lynxObj: LynxLike | undefined = typeof lynx !== 'undefined'
        ? (lynx as LynxLike)
        : undefined;
    return parseScreen(lynxObj?.__globalProps?.[SCREEN_GLOBAL_KEY], 1);
}

/**
 * `__globalProps` → `SystemInfo` (via {@link Platform}) → typical-phone
 * constants. The middle step covers hosts running an engine build without the
 * publisher; it's a load-time snapshot, so it can't follow rotation — that's
 * precisely why the publisher exists.
 */
function resolveScreen(): ScreenMetrics {
    const published = readGlobalScreen();
    if (published) return published;

    const scale = Platform.pixelRatio || 1;
    const width = Platform.pixelWidth > 0
        ? Math.round(Platform.pixelWidth / scale)
        : FALLBACK_WIDTH;
    const height = Platform.pixelHeight > 0
        ? Math.round(Platform.pixelHeight / scale)
        : FALLBACK_HEIGHT;
    const orientation: ScreenOrientation = width > height ? 'landscape-left' : 'portrait';
    return { width, height, scale, orientation, isLandscape: isLandscapeOrientation(orientation) };
}

// The single source of truth. Seeded lazily on first reactive read (the
// publisher writes __globalProps before first paint, so the first read is
// correct on cold start); updated by the publishers' `screenChanged` event.
const state = signal(resolveScreen());
let emitterWired = false;
let seeded = false;
let metricsComputed: Computed<ScreenMetrics> | undefined;
let orientationComputed: Computed<CoarseOrientation> | undefined;

const apply = (next: ScreenMetrics): void => {
    // Field-wise so the signal's own dedup can spare downstream recomputes
    // when only one dimension moved (a keyboard-driven republish, say).
    state.width = next.width;
    state.height = next.height;
    state.scale = next.scale;
    state.orientation = next.orientation;
    state.isLandscape = next.isLandscape;
};

/**
 * Wire the native event subscription + `__globalProps` seed, lazily. The latch
 * is only set on SUCCESS (same pattern as core's app-state and font-scale): if
 * the first call races runtime init and the emitter isn't reachable yet, a
 * later call retries. Off-device neither ever succeeds — the signal keeps its
 * resolved fallback, the correct degradation.
 *
 * Process-lifetime singleton subscription: no teardown exists in the public
 * surface (`useScreen()` hands back a `Computed`), so the disposer is
 * deliberately dropped.
 */
const ensureWired = (): void => {
    if (!seeded) {
        const initial = readGlobalScreen();
        if (initial) {
            seeded = true;
            apply(initial);
        }
    }
    if (!emitterWired && isNativeEventsAvailable()) {
        subscribeNative<RawScreenProps>(
            SCREEN_EVENT,
            (raw) => {
                // `state.scale` (not 1) is the fallback: a publisher that omits
                // `scale` must not reset the density to 1.
                const next = parseScreen(raw, state.scale);
                if (!next) return;
                seeded = true;
                apply(next);
            },
            { validate: isRawScreen, namespace: 'lynx-core' },
        );
        emitterWired = true;
    }
};

/**
 * BG-side reactive screen metrics. Returns a stable `Computed<ScreenMetrics>` —
 * read `.value` in render/effects and the component re-renders on rotation,
 * split-screen resize, or foldable unfold.
 *
 * @example
 * ```tsx
 * const screen = useScreen();
 * return () => <view class={screen.value.isLandscape ? 'flex-row' : 'flex-col'} />;
 * ```
 */
export function useScreen(): Computed<ScreenMetrics> {
    ensureWired();
    if (!metricsComputed) {
        metricsComputed = computed(() => ({
            width: state.width,
            height: state.height,
            scale: state.scale,
            orientation: state.orientation,
            isLandscape: state.isLandscape,
        }));
    }
    return metricsComputed;
}

/**
 * BG-side reactive coarse orientation — the narrow read for code that only
 * branches portrait/landscape and shouldn't re-run when the width alone moves.
 */
export function useOrientation(): Computed<CoarseOrientation> {
    ensureWired();
    if (!orientationComputed) {
        orientationComputed = computed<CoarseOrientation>(() =>
            state.isLandscape ? 'landscape' : 'portrait');
    }
    return orientationComputed;
}

/**
 * MT-thread synchronous screen metrics. For use inside `'main thread'`-marked
 * worklet bodies. Reads `lynx.__globalProps` directly — no subscription, so
 * callers re-evaluate per worklet invocation (which is what you want: a
 * gesture handler should measure against the CURRENT viewport).
 */
export function useScreenMT(): ScreenMetrics {
    return resolveScreen();
}
