/**
 * The sheet engine — the SharedValue/geometry core both sheet frontends
 * drive: the standalone `<BottomSheet>` component and lynx-navigation's
 * `presentation: 'sheet'` adapter. Ported mechanically from
 * lynx-navigation's inline `BottomSheet.tsx` internals (the #743/#744
 * live-geometry pipeline, the `openToLift` main-thread capture, and the
 * lift composition) so the tuned WhatsApp-composer behaviors survive
 * verbatim.
 *
 * ## Ownership contracts (the load-bearing invariants)
 *
 * - `reveal` (px visible height) is **MT-owned**: the pan writes it per
 *   frame (auto-flushed, #681), `withTiming` animates it, `syncGeom`
 *   clamps it. The BG never reads it for logic. It is *injected* by the
 *   navigator for route sheets (their layer bindings already target it)
 *   and engine-allocated for inline sheets.
 * - Geometry flows BG→MT **only** through `syncGeom` into `geomRef` — a
 *   main-thread ref the worklets read live. Never capture geometry as BG
 *   lexicals in a worklet: a `runOnMainThread` closure captures its
 *   referenced lexicals when the expression evaluates, freezing them at
 *   setup (the exact bug class #743 fixed). New worklet-visible state
 *   extends `geomRef` + `syncGeom`, never fresh captures.
 * - `combined = max(reveal, floor + liftSV)` — the effective reveal also
 *   clears an external (keyboard) lift. Derived-SV identities are stable
 *   across re-registration, so downstream bindings stay bound while the
 *   floor changes at runtime.
 */
import {
    onUnmounted,
    runOnMainThread,
    useDerivedValue,
    useDerivedValueReactive,
    useMainThreadRef,
    useSharedValue,
    type MainThreadRef,
    type SharedValue,
} from '@sigx/lynx';
import { cancelAnimation, withTiming } from '@sigx/lynx-motion';

/** Release-snap / open-close tween duration (unified across frontends). */
export const SNAP_SEC = 0.2;
/**
 * Pre-computed ms for BG-side timers — module-level so both MT worklets
 * and BG callback closures can see it (locals inside an MT worklet body
 * are MT-only).
 */
export const SNAP_MS = Math.round(SNAP_SEC * 1000);

/** Live geometry, resolved by the frontend on every render. */
export interface SheetGeometry {
    /** Collapsed floor (px) — `detents[0]`. */
    floor: number;
    /** The detent `open` targets. */
    open: number;
    /** The largest detent. */
    top: number;
    /** All detents, ascending px. */
    detents: number[];
}

export interface SheetEngineConfig {
    /**
     * Live geometry accessor — evaluated at every render/sync, NEVER
     * snapshotted at setup: a composer accessory (the headline use case)
     * has a floor that changes at runtime — an attachment chip row
     * appears, the text input grows from 1 to N lines. Freezing geometry
     * at setup would leave the sheet at its mount-time size while its
     * content grew underneath it (#743).
     */
    geometry: () => SheetGeometry;
    /**
     * Live fixed panel height (px) — the panel is laid out this tall and
     * slid down by `translateY = panelHeight - combined` (a TRANSFORM,
     * safe to drive from the main thread every frame, unlike `height`).
     */
    panelHeight: () => number;
    /**
     * The reveal SV to drive. The navigator INJECTS its dedicated sheet
     * SV (layer/backdrop bindings already target it); inline sheets omit
     * this and the engine allocates one seeded at the floor.
     */
    reveal?: SharedValue<number>;
    /**
     * External lift (px) under the collapsed reveal — a keyboard lift SV.
     * Effective reveal is `max(reveal, floor + liftSV)`.
     */
    liftSV?: SharedValue<number> | null;
    /**
     * Snap to the live lifted position on open instead of the BG detent
     * (mount-constant; requires `liftSV`). See `setOpen`'s capture path.
     */
    openToLift?: boolean;
    /**
     * Fires on the BG thread when a drag settles at a snap candidate.
     * Debounced by the engine: a quick re-grab+release must not let an
     * earlier settle timer still fire a stale index — only the latest
     * release emits.
     */
    onSnap?: (candidateIndex: number) => void;
}

/** Worklet-visible geometry + flags, pushed from render via `syncGeom`. */
export interface SheetWorkletGeometry {
    min: number;
    max: number;
    detents: number[];
    /** `1` = releases below the dismiss line settle at reveal 0. */
    dismissible: number;
    /**
     * `1` = the pan may claim; `0` = drag frozen (`dragEnabled: false`).
     * Lives HERE (not in a render-written SharedValue) because a BG-side
     * `sv.value =` write is a read-only no-op — the only way a render-time
     * flag reaches a worklet is this syncGeom push (the bug noted in #758:
     * post-mount dragEnabled changes silently never arrived).
     */
    gate: number;
    /**
     * Page-coord Y of the sheet's bottom edge (`sheetTop = bottomEdge -
     * combined` in the surface-drag arbitration). The screen height for a
     * screen-anchored sheet; `screenH - bottomOffset` when an ancestor
     * pads the bottom safe area. Same syncGeom-only rule as `gate`.
     */
    bottomEdge: number;
}

/** Per-gesture transient state (main-thread ref). */
export interface SheetDragTransient {
    startX: number;
    startY: number;
    /** Baseline for reveal mapping — set at CLAIM, not touch start. */
    claimY: number;
    startReveal: number;
    prevY: number;
    prevT: number;
    /** px/sec, positive = downward. */
    vel: number;
    /** `OWNER_*` from math.ts. */
    owner: number;
    active: number;
    gen: number;
}

export interface SheetEngine {
    reveal: SharedValue<number>;
    /** `max(reveal, floor + lift)` — bind panels/backdrops/siblings to this. */
    combined: SharedValue<number>;
    /** `panelHeight - combined` — bind the panel's translateY to this. */
    translateY: SharedValue<number>;
    geomRef: MainThreadRef<SheetWorkletGeometry>;
    /** The open REST reveal — the captured lift position under `openToLift`. */
    openRestRef: MainThreadRef<{ rest: number }>;
    drag: MainThreadRef<SheetDragTransient>;
    /** Mount-constant: `openToLift && liftSV` was configured. */
    openToLift: boolean;
    /**
     * Push current geometry + flags to the worklets (render calls this
     * after diffing — including on a bare `gate`/`dismissible` flip).
     * Clamps stranded MT state when detents shrank.
     */
    syncGeom: (min: number, max: number, ds: number[], dismissible: number, gate: number, bottomEdge: number) => unknown;
    /**
     * Move to a target reveal. `capture === 1` (the `openToLift` path)
     * snaps to the CURRENT lifted position read live on the MT instead —
     * see the port note inside.
     */
    setReveal: (target: number, animate: number, capture: number, openFloor: number) => unknown;
    /** BG-side debounced settle emit — the pan's release hop calls this. */
    scheduleSnap: (candidateIndex: number) => void;
}

export function useSheetEngine(cfg: SheetEngineConfig): SheetEngine {
    const seed = cfg.geometry();

    // The drag/animation-owned reveal (px visible above the bottom edge).
    const reveal = cfg.reveal ?? useSharedValue(seed.floor);

    const liftSV = cfg.liftSV ?? null;
    // Reactive so the offsets track a changing floor. The derived SV
    // identity is stable across re-registration, so downstream consumers
    // (`combined`, `translateY`, `onReveal`) stay bound.
    const liftedFloor = liftSV
        ? useDerivedValueReactive(() => ({
            sources: [liftSV],
            reducer: 'scale' as const,
            params: { factor: 1, offset: cfg.geometry().floor },
        }))
        : null;
    const combined = liftedFloor
        ? useDerivedValue([reveal, liftedFloor], 'max')
        : reveal;
    // translateY = panelHeight - combined (slide the fixed-height box down
    // so only `combined` px show).
    const translateY = useDerivedValueReactive(() => ({
        sources: [combined],
        reducer: 'scale' as const,
        params: { factor: -1, offset: cfg.panelHeight() },
    }));

    const openToLift = cfg.openToLift === true && liftSV != null;
    const openRestRef = useMainThreadRef({ rest: seed.open });
    const geomRef = useMainThreadRef<SheetWorkletGeometry>({
        min: seed.floor,
        max: seed.top,
        detents: seed.detents,
        dismissible: 0,
        gate: 1,
        bottomEdge: 0,
    });

    const syncGeom = runOnMainThread((min: number, max: number, ds: number[], dismissible: number, gate: number, bottomEdge: number) => {
        'main thread';
        geomRef.current.min = min;
        geomRef.current.max = max;
        geomRef.current.detents = ds;
        geomRef.current.dismissible = dismissible;
        geomRef.current.gate = gate;
        geomRef.current.bottomEdge = bottomEdge;
        // Detents that SHRANK can strand state that predates them: a
        // `reveal` above the new top would keep rendering out of bounds
        // until the next drag re-clamped it, and a captured `openToLift`
        // rest would stay an out-of-range snap candidate. Pull both back
        // into the new range. (A dismissible sheet parked below the floor
        // — reveal 0 — is legitimate; only clamp upward when persistent.)
        let r = reveal.current.value;
        if (dismissible === 0 && r < min) r = min;
        if (r > max) r = max;
        if (r !== reveal.current.value) {
            // An in-flight tween is heading somewhere equally out of range.
            cancelAnimation(reveal);
            reveal.current.value = r;
        }
        let rest = openRestRef.current.rest;
        if (rest < min) rest = min;
        if (rest > max) rest = max;
        openRestRef.current.rest = rest;
    });

    const setReveal = runOnMainThread((target: number, animate: number, capture: number, openFloor: number) => {
        'main thread';
        cancelAnimation(reveal);
        let t = target;
        if (capture === 1) {
            // Capture the CURRENT lifted position (== the keyboard-mode
            // height, read live on the MT while the keyboard is still up)
            // so that when the keyboard's lift then animates to 0 the
            // content does NOT move — a BG-computed detent can't equal the
            // live MT lift, hence the jump this avoids. Clamp to at least
            // the fallback detent (no keyboard was up) and at most the top.
            let c = combined.current.value;
            if (c < openFloor) c = openFloor;
            if (c > geomRef.current.max) c = geomRef.current.max;
            t = c;
            openRestRef.current.rest = c;
        }
        if (animate === 1) withTiming(reveal, t, { duration: SNAP_SEC });
        else reveal.current.value = t;
    });

    // Per-gesture transient — a `useMainThreadRef`: each gesture handler
    // is its own worklet with its own deep-copied `_c`, so a plain closure
    // object would not share mutations across handlers.
    const drag = useMainThreadRef<SheetDragTransient>({
        startX: 0,
        startY: 0,
        claimY: 0,
        startReveal: 0,
        prevY: 0,
        prevT: 0,
        vel: 0,
        owner: 0,
        active: 0,
        gen: 0,
    });

    // Debounced snap emit (BG): only the latest release's settle emits.
    let snapTimer: ReturnType<typeof setTimeout> | null = null;
    const onSnap = cfg.onSnap;
    const scheduleSnap = (i: number): void => {
        if (!onSnap) return;
        if (snapTimer !== null) clearTimeout(snapTimer);
        snapTimer = setTimeout(() => {
            snapTimer = null;
            onSnap(i);
        }, SNAP_MS);
    };
    onUnmounted(() => {
        if (snapTimer !== null) clearTimeout(snapTimer);
    });

    return {
        reveal,
        combined,
        translateY,
        geomRef,
        openRestRef,
        drag,
        openToLift,
        syncGeom,
        setReveal,
        scheduleSnap,
    };
}
