/**
 * Anchored positioning on lynx — zero's `PositionStrategy` SHAPE over the
 * platform's real measurement primitives.
 *
 * Geometry comes from `useViewportRect` (`boundingClientRect`) — NOT from
 * `bindlayoutchange`'s payload. The event's coordinates are not
 * page-relative on Android (#1080: correct size, `top/left` of 0 — the
 * select's list clamped to the screen corner), and even where they are
 * (iOS) they are layout-time numbers, blind to scroll and transforms. So
 * layout events serve only as "something moved, re-measure" triggers, and
 * the floating panel's own measure re-measures the anchor too — a popup
 * opening after a scroll positions against where the anchor IS, not where
 * layout first put it.
 *
 * The math is a pure function (`computeAnchorPosition`) so it tests over
 * fake rects; the wiring half (`createAnchorPosition`) owns the two
 * measured rects and recomputes whenever either lands. Mid-scroll tracking
 * of an OPEN popup is still out of scope: nothing re-fires while scrolling
 * (overlays that open from a scrolling anchor should close on scroll).
 *
 * The math runs in OUTLET space, not viewport space (#1146): the anchor rect
 * is shifted by the outlet's measured origin and flip/clamp reason against
 * the outlet's own box. Both rects are viewport rects measured together, so
 * any translation their common ancestors carry — a navigation screen sliding
 * in, which moves anchor and outlet alike — cancels out. Viewport-space math
 * did not survive that: an overlay opened at mount measured its origin once,
 * mid slide-in (a screen width to the right), the anchor again after the
 * slide settled, and the popup landed a screen width off to the LEFT. So
 * every re-measure trigger measures the origin too.
 *
 * Since #1169 the outlet is a full-window `position: fixed` layer, so its
 * origin no longer rides a screen transform at all; the clamp box is the
 * host's SAFE FRAME (its content box), measured with the same triggers and
 * ignored while it pokes out of the outlet (mid-transform). The popup
 * itself sits in the fixed layer, so it does not slide with its screen
 * during a push; it lands where the anchor was last measured.
 *
 * Placement values are the zero contract's `PLACEMENT_VOCABULARY` subset the
 * popup's anatomy declares — the runtime stamps the RESOLVED side (after
 * flipping) through `partBag`, exactly like the web behavior does.
 */
import { defineInjectable, defineProvide, effect, onUnmounted, signal, useScreen, useViewportRect } from '@sigx/lynx';
import type { ElementLayout, LayoutChangeEvent, MainThread, MainThreadRef } from '@sigx/lynx';

/**
 * The overlay outlet's own viewport rect, plus the SAFE FRAME inside it.
 *
 * The outlet is a full-window layer (`position: fixed`, #1169): a modal
 * backdrop has to dim the whole screen, edge to edge, and a toast's shadow
 * must not be clipped at a safe-area inset. The floating panel renders
 * absolutely inside that layer, so `rect` is the layer's rect: the page
 * root's origin and the layer's layout size (`fixedOutletRect` — derived,
 * not measured, #1181).
 *
 * The `frame` is the host's own content box: whatever the app laid it out
 * in — below a navigation header, inside a `SafeAreaView`'s padding. Content
 * respects it: anchored popups flip/clamp against it (#1086), the dialog
 * panel centers in it, and toasts pin to its edges. Unknown when nothing
 * provides (an outlet at the viewport origin, the screen as its box).
 */
interface OverlayOrigin {
    rect(): ElementLayout | null;
    frame(): ElementLayout | null;
    measure(): void;
    /**
     * The outlet's height with no keyboard: the tallest the host has laid it
     * out at the current width. What `keyboardOverlap` compares against, so
     * a window that resized for the keyboard (Android `adjustResize`) is not
     * lifted twice (#1232).
     */
    fullHeight(): number;
}

const useOverlayOriginInjectable = defineInjectable<OverlayOrigin>(() => ({
    rect: () => null,
    frame: () => null,
    measure: () => {},
    fullHeight: () => 0,
}));

/**
 * Provide the overlay outlet's measured viewport rect (OverlayHost wires
 * this), a way to re-measure it, and optionally the safe frame content
 * should respect. Anchored overlays call `measure` alongside their own
 * measurements, so the outlet, the frame and the anchor always come from
 * the same moment.
 */
export function provideOverlayOrigin(
    read: () => ElementLayout | null,
    measure: () => void = () => {},
    frame: () => ElementLayout | null = () => null,
    fullHeight: () => number = () => read()?.height ?? 0,
): void {
    defineProvide(useOverlayOriginInjectable, () => ({ rect: read, frame, measure, fullHeight }));
}

/**
 * Track the tallest height a box has had at its current width — the
 * outlet's no-keyboard height (`OverlayOrigin.fullHeight`). A width change
 * (rotation, split view) starts over. Returns a reader to call with the
 * current size; pure bookkeeping, so it tests without a host. @internal
 */
export function tallestAtWidth(): (size: { width: number; height: number } | null) => number {
    let width = 0;
    let tallest = 0;
    return (size) => {
        if (!size || !(size.width > 0) || !(size.height > 0)) return tallest;
        if (Math.abs(size.width - width) > EPSILON) {
            width = size.width;
            tallest = size.height;
        } else if (size.height > tallest) {
            tallest = size.height;
        }
        return tallest;
    };
}

/** The nearest outlet's no-keyboard height (see `tallestAtWidth`), reactive. @internal */
export function useOutletFullHeight(): () => number {
    const origin = useOverlayOriginInjectable();
    return () => origin.fullHeight();
}

/**
 * The outlet layer's rect. The layer is `position: fixed` with all four
 * edges at 0, so it sits at the page root's origin by construction — the
 * same origin viewport rects are reported against — and only its SIZE is
 * unknown: its own layout size once it has one, the screen until then.
 * Deliberately not measured with `boundingClientRect`: on iOS that returned
 * a shifted rect for the fixed layer, which rejected the safe frame and
 * pushed anchored popups into the right-edge clamp (#1181, #1182). Pure.
 */
export function fixedOutletRect(
    size: { width: number; height: number } | null,
    screen: { width: number; height: number },
): ElementLayout | null {
    const s = size && size.width > 0 && size.height > 0 ? size : screen;
    if (!(s.width > 0) || !(s.height > 0)) return null;
    return { top: 0, left: 0, width: s.width, height: s.height, right: s.width, bottom: s.height };
}

/** How far the safe frame sits inside the outlet, per edge (px). */
export interface OverlayInsets {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

const NO_INSETS: OverlayInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Sub-pixel slack for rounding in measured rects. */
const EPSILON = 1;

/**
 * The frame, when it is usable: measured, with a size, and CONTAINED in the
 * outlet. A frame that pokes out of the outlet was measured mid-transform —
 * a screen sliding in on a push sits a screen width to the right — and
 * means nothing until it is re-measured; callers then fall back to the
 * whole outlet. Pure, over fake rects.
 */
export function containedFrame(origin: ElementLayout | null, frame: ElementLayout | null): ElementLayout | null {
    if (!origin || !frame || frame.width <= 0 || frame.height <= 0) return null;
    const inside = frame.top >= origin.top - EPSILON
        && frame.left >= origin.left - EPSILON
        && frame.top + frame.height <= origin.top + origin.height + EPSILON
        && frame.left + frame.width <= origin.left + origin.width + EPSILON;
    return inside ? frame : null;
}

/**
 * The safe frame's insets inside the outlet — what a full-window overlay
 * pads its content by (the dialog panel centers inside them, a toast
 * viewport pins to them). All zero when either rect is unknown or the frame
 * is not contained (see `containedFrame`). Pure, over fake rects.
 */
export function computeOverlayInsets(origin: ElementLayout | null, frame: ElementLayout | null): OverlayInsets {
    const f = containedFrame(origin, frame);
    if (!origin || !f) return NO_INSETS;
    const clamp = (n: number): number => Math.max(0, Math.round(n));
    return {
        top: clamp(f.top - origin.top),
        left: clamp(f.left - origin.left),
        bottom: clamp(origin.top + origin.height - (f.top + f.height)),
        right: clamp(origin.left + origin.width - (f.left + f.width)),
    };
}

/**
 * The reactive safe-frame insets of the nearest overlay outlet. Read inside
 * a render or effect (the portal closure) — it tracks both measurements.
 */
export function useOverlayInsets(): () => OverlayInsets {
    const origin = useOverlayOriginInjectable();
    return () => computeOverlayInsets(origin.rect(), origin.frame());
}

/**
 * An absolute style that fills the outlet — the whole window. The outlet
 * layer is 0×0 on purpose (a full-window layer swallowed every native pan on
 * iOS, #1190), so `top/left/right/bottom: 0` inside it collapses to nothing:
 * a root that must cover the window (a modal backdrop, a light-dismiss
 * surface) states the outlet's size instead. Before any size is known it
 * falls back to the four-edge spelling. Reactive — read it in the portal
 * closure.
 */
export function useOutletFill(): () => Record<string, string | number> {
    const origin = useOverlayOriginInjectable();
    return () => outletFill(origin.rect());
}

/** The nearest outlet's rect (window-sized, at the origin), reactive. @internal */
export function useOutletRect(): () => ElementLayout | null {
    const origin = useOverlayOriginInjectable();
    return () => origin.rect();
}

/** `useOutletFill`'s style for a given outlet rect. Pure. @internal */
export function outletFill(outlet: ElementLayout | null): Record<string, string | number> {
    if (!outlet || !(outlet.width > 0) || !(outlet.height > 0)) {
        return { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 };
    }
    return { position: 'absolute', top: 0, left: 0, width: `${outlet.width}px`, height: `${outlet.height}px` };
}

/**
 * Viewport → outlet coordinates: subtract the outlet's viewport origin from
 * a viewport-space position. Identity when the origin is unknown (an outlet
 * at the viewport origin). Pure, so the conversion tests over fake rects.
 */
export function toOutletCoordinates(
    p: { top: number; left: number },
    origin: { top: number; left: number } | null,
): { top: number; left: number } {
    return { top: p.top - (origin?.top ?? 0), left: p.left - (origin?.left ?? 0) };
}

/** Whether two measured rects describe the same box, within rounding. */
export function sameRect(a: ElementLayout, b: ElementLayout): boolean {
    return Math.abs(a.left - b.left) <= EPSILON
        && Math.abs(a.top - b.top) <= EPSILON
        && Math.abs(a.width - b.width) <= EPSILON
        && Math.abs(a.height - b.height) <= EPSILON;
}

export interface SettleOptions {
    /** ms between re-measures while the rect is still moving. Default 100. */
    interval?: number;
    /** Re-measures per burst before giving up. Default 40. */
    budget?: number;
    /** Ticks a `kick()` forces even while measurements agree. Default 5. */
    kickTicks?: number;
    /**
     * Also keep going while this is true, even if two measurements agreed:
     * the safe frame poking out of the outlet is mid-transform by definition.
     */
    unsettled?: () => boolean;
}

export interface SettleHandle {
    /**
     * Something may start moving the rect without a layout event (a finger
     * leaving a scroll view mid-fling): measure on the next frame and keep
     * measuring for `kickTicks` ticks even if the measurements agree, then
     * settle as usual. Kicks within one frame coalesce into one measurement.
     */
    kick(): void;
}

/** A measurement: one function, or several taken together. */
export type MeasureRequest = (() => void) | ReadonlyArray<() => void>;

/**
 * Deadlines closer together than this share one measurement batch: loops
 * due within one frame of the earliest fire together.
 */
const FRAME_MS = 16;

interface SettleTick {
    /** When this loop wants its next measurement (ms, `Date.now()` clock). */
    due: number;
    /** Add this loop's measurements to the frame's batch. */
    fire(batch: Set<() => void>): void;
}

/**
 * ONE clock for every settle loop on the page (#1200). A screen of anchored
 * popups used to run one timer each, and every tick measured its anchor AND
 * the shared outlet frame: dozens of measurements per frame during a push
 * slide, each one a `Lynx.Sigx.AvPublish` event, past the engine's
 * per-window event limit. Now pending loops wait on a single timer, every
 * loop due within a frame of it fires in the same batch, and a measurement
 * requested by several loops (the outlet frame every anchor re-measures)
 * runs once per batch.
 */
const pendingTicks = new Set<SettleTick>();
let clockTimer: ReturnType<typeof setTimeout> | null = null;
let clockDue = Infinity;

function armClock(): void {
    let earliest = Infinity;
    for (const t of pendingTicks) earliest = Math.min(earliest, t.due);
    if (earliest === Infinity) {
        if (clockTimer !== null) clearTimeout(clockTimer);
        clockTimer = null;
        clockDue = Infinity;
        return;
    }
    if (clockTimer !== null && clockDue <= earliest) return;
    if (clockTimer !== null) clearTimeout(clockTimer);
    clockDue = earliest;
    clockTimer = setTimeout(runClock, Math.max(0, earliest - Date.now()));
}

function runClock(): void {
    clockTimer = null;
    clockDue = Infinity;
    const cutoff = Date.now() + FRAME_MS;
    const batch = new Set<() => void>();
    for (const t of [...pendingTicks]) {
        if (t.due > cutoff) continue;
        pendingTicks.delete(t);
        t.fire(batch);
    }
    for (const m of batch) m();
    armClock();
}

function addMeasure(batch: Set<() => void>, measure: MeasureRequest): void {
    if (typeof measure === 'function') batch.add(measure);
    else for (const m of measure) batch.add(m);
}

/** Pending settle ticks on the shared clock (tests). @internal */
export function pendingSettleTicks(): number {
    return pendingTicks.size;
}

/**
 * Keep re-measuring a rect until it stops moving (#1181, #1182). `read`
 * returns the rect, or several (the first one is the subject: nothing
 * happens until it has measured, or while `read` returns null) that must ALL
 * hold still. A TRANSFORM never fires a layout event, so a rect measured
 * while its screen slides in on a push (a screen width to the right, and
 * still moving) was the last one anything took: popups opened at mount
 * stayed clamped to the right edge, and the safe frame poked out of the
 * outlet, so toasts lost their insets. Whenever a measurement lands that
 * differs from the previous one (or `unsettled()` holds, or a `kick()` is
 * pending), this measures again after `interval`, until two in a row agree
 * or the budget runs out.
 *
 * Cheap by construction (#1200): every loop ticks on one shared clock, loops
 * due in the same frame measure in one batch, and a measure function passed
 * by several loops (give them the SAME function) runs once per batch. Pass
 * `measure` as an array to let its parts dedupe separately. Reactive over
 * `read`, so call it in setup; the pending tick is dropped on unmount.
 * @internal
 */
export function settleRect(
    read: () => ElementLayout | null | ReadonlyArray<ElementLayout | null>,
    measure: MeasureRequest,
    options: SettleOptions = {},
): SettleHandle {
    const interval = options.interval ?? 100;
    const budget = options.budget ?? 40;
    const kickTicks = options.kickTicks ?? 5;
    let last: ReadonlyArray<ElementLayout | null> | null = null;
    let tries = 0;
    let lastTick = 0;
    let forced = 0;
    let alive = true;
    const tick: SettleTick = {
        due: 0,
        fire(batch) {
            addMeasure(batch, measure);
            // A measurement that lands UNCHANGED may not re-run the effect
            // below (same value, nothing to notify), so the loop keeps itself
            // alive for the conditions a rect change cannot show: forced
            // ticks and `unsettled()`. A change re-arms it through the effect.
            if ((forced > 0 || (options.unsettled?.() ?? false)) && tries < budget) schedule(interval);
        },
    };
    const scheduled = (): boolean => pendingTicks.has(tick);
    const schedule = (delay: number): void => {
        if (!alive) return;
        tries++;
        lastTick = Date.now();
        if (forced > 0) forced--;
        tick.due = Date.now() + delay;
        pendingTicks.add(tick);
        armClock();
    };
    effect(() => {
        const value = read();
        const rects = Array.isArray(value) ? value as ReadonlyArray<ElementLayout | null> : [value as ElementLayout | null];
        const unsettled = options.unsettled?.() ?? false;
        if (!rects[0]) {
            // Inactive (nothing measured yet, or the caller switched the loop
            // off — a closed popup): drop any pending tick, and forget the
            // last rects so the next activation counts as a change.
            last = null;
            if (scheduled()) {
                pendingTicks.delete(tick);
                armClock();
            }
            return;
        }
        const prev = last;
        const changed = !prev || prev.length !== rects.length || rects.some((r, i) => {
            const p = prev[i];
            return !r || !p ? r !== p : !sameRect(p, r);
        });
        const moving = changed || unsettled || forced > 0;
        last = rects;
        // A new burst (the rect moved again long after it settled) gets a
        // fresh budget.
        if (Date.now() - lastTick > interval * 3) tries = 0;
        if (!moving || scheduled() || tries >= budget) return;
        schedule(interval);
    });
    onUnmounted(() => {
        alive = false;
        if (pendingTicks.delete(tick)) armClock();
    });
    return {
        kick() {
            forced = kickTicks;
            tries = 0;
            // Next frame, not now: a touch stream kicks on every move event,
            // and those coalesce into one measurement per frame.
            if (!scheduled()) schedule(0);
            else if (tick.due > Date.now()) {
                tick.due = Date.now();
                armClock();
            }
        },
    };
}

/**
 * An ancestor that moves its subtree with a TRANSFORM — a dialog panel's
 * open animation (daisy's `zero-daisy-pop`: scale 0.95 → 1) — and so fires
 * no layout event when it stops (#1233). An anchored popup opened inside
 * the panel measured its trigger mid-animation; on iOS two measurements
 * taken before the animation visibly moves agree, the settle loop ended,
 * and the list stayed anchored where the trigger was at scale 0.95 (about
 * 8pt right of it on a phone). The ancestor bumps `settled()` whenever its
 * motion ends; every anchored popup under it re-measures once per bump.
 */
interface AncestorMotion {
    /** A counter bumped each time an ancestor's motion ends. Reactive. */
    settled(): number;
}

const useAncestorMotionInjectable = defineInjectable<AncestorMotion>(() => ({ settled: () => 0 }));

export interface AncestorMotionHandle {
    /** The ancestor's motion ended (an animation or transition end, or a fallback timer). */
    bump(): void;
    /**
     * Provide the motion to the subtree. Call where the subtree resolves its
     * injections — for a portaled panel, inside its `PortalScope` setup. The
     * enclosing ancestors' motion (captured when the handle was created)
     * counts too, so a popup in a dialog in a dialog follows both panels.
     */
    provide(): void;
}

/**
 * The mover's half of `AncestorMotion`: call in the moving component's
 * setup (it captures the enclosing motion there), `bump()` when the motion
 * ends, and `provide()` to the subtree. @internal
 */
export function createAncestorMotion(): AncestorMotionHandle {
    const parent = useAncestorMotionInjectable();
    const own = signal({ count: 0 });
    const motion: AncestorMotion = { settled: () => parent.settled() + own.count };
    return {
        bump: () => {
            own.count++;
        },
        provide: () => defineProvide(useAncestorMotionInjectable, () => motion),
    };
}

export type LynxPlacement =
    | 'top' | 'top-start' | 'top-end'
    | 'bottom' | 'bottom-start' | 'bottom-end'
    | 'left' | 'left-start' | 'left-end'
    | 'right' | 'right-start' | 'right-end';

export interface AnchorPositionOptions {
    placement?: LynxPlacement;
    /** Gap between anchor and popup, px. */
    offset?: number;
    /** Minimum distance from the viewport edge before flipping, px. */
    viewportPadding?: number;
}

export interface ResolvedPosition {
    top: number;
    left: number;
    /** The side that actually rendered, after flipping. */
    placement: LynxPlacement;
}

interface Size {
    width: number;
    height: number;
}

const side = (placement: LynxPlacement): 'top' | 'bottom' | 'left' | 'right' =>
    placement.split('-')[0] as 'top' | 'bottom' | 'left' | 'right';

const alignment = (placement: LynxPlacement): 'start' | 'end' | undefined =>
    placement.split('-')[1] as 'start' | 'end' | undefined;

const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const;

function mainAxisStart(anchor: ElementLayout, floating: Size, s: 'top' | 'bottom' | 'left' | 'right', offset: number): number {
    switch (s) {
        case 'top': return anchor.top - floating.height - offset;
        case 'bottom': return anchor.bottom + offset;
        case 'left': return anchor.left - floating.width - offset;
        case 'right': return anchor.right + offset;
    }
}

function crossAxisStart(anchor: ElementLayout, floating: Size, placement: LynxPlacement): number {
    const s = side(placement);
    const align = alignment(placement);
    const vertical = s === 'top' || s === 'bottom';
    const anchorStart = vertical ? anchor.left : anchor.top;
    const anchorSize = vertical ? anchor.width : anchor.height;
    const floatingSize = vertical ? floating.width : floating.height;
    if (align === 'start') return anchorStart;
    if (align === 'end') return anchorStart + anchorSize - floatingSize;
    return anchorStart + anchorSize / 2 - floatingSize / 2;
}

/**
 * The placement math, pure. Flips to the opposite side when the preferred
 * one overflows the viewport and the opposite fits better; clamps the cross
 * axis into the viewport either way.
 */
export function computeAnchorPosition(
    anchor: ElementLayout,
    floating: Size,
    viewport: { width: number; height: number },
    options: AnchorPositionOptions = {},
): ResolvedPosition {
    const preferred = options.placement ?? 'bottom';
    const offset = options.offset ?? 4;
    const padding = options.viewportPadding ?? 8;

    let s = side(preferred);
    const vertical = s === 'top' || s === 'bottom';
    const limit = vertical ? viewport.height : viewport.width;
    const size = vertical ? floating.height : floating.width;

    const fits = (candidate: typeof s): boolean => {
        const start = mainAxisStart(anchor, floating, candidate, offset);
        return start >= padding && start + size <= limit - padding;
    };
    if (!fits(s) && fits(OPPOSITE[s])) s = OPPOSITE[s];
    const placement = (alignment(preferred) ? `${s}-${alignment(preferred)}` : s) as LynxPlacement;

    const main = mainAxisStart(anchor, floating, s, offset);
    const crossLimit = vertical ? viewport.width : viewport.height;
    const crossSize = vertical ? floating.width : floating.height;
    const cross = Math.min(
        Math.max(crossAxisStart(anchor, floating, placement), padding),
        Math.max(crossLimit - crossSize - padding, padding),
    );

    return vertical
        ? { top: main, left: cross, placement }
        : { top: cross, left: main, placement };
}

/**
 * The placement in OUTLET coordinates — what the floating panel's
 * `top`/`left` take. With a measured outlet (`origin`, a viewport rect with
 * a size) the anchor shifts into outlet space and flip/clamp reason against
 * the outlet's box, so a translation shared by anchor and outlet (a screen
 * mid push-transition) cancels out exactly. Without one it falls back to
 * the screen as the box and the identity origin. Pure, over fake rects.
 */
export function computeOutletPosition(
    anchor: ElementLayout,
    floating: Size,
    origin: ElementLayout | null,
    screen: { width: number; height: number },
    options: AnchorPositionOptions = {},
): ResolvedPosition {
    if (!origin || origin.width <= 0 || origin.height <= 0) {
        return computeAnchorPosition(anchor, floating, screen, options);
    }
    const local: ElementLayout = {
        top: anchor.top - origin.top,
        left: anchor.left - origin.left,
        right: anchor.right - origin.left,
        bottom: anchor.bottom - origin.top,
        width: anchor.width,
        height: anchor.height,
    };
    return computeAnchorPosition(local, floating, { width: origin.width, height: origin.height }, options);
}

/**
 * `computeOutletPosition` with a safe frame: flip/clamp against the frame
 * (the host's content box, below any header and inside the safe-area
 * insets) when it is usable, then shift the result from frame space into
 * the outlet layer's space. Without a usable frame it is exactly
 * `computeOutletPosition` over the outlet. Pure, over fake rects.
 *
 * @internal
 */
export function computeFramedPosition(
    anchor: ElementLayout,
    floating: Size,
    outlet: ElementLayout | null,
    frame: ElementLayout | null,
    screen: { width: number; height: number },
    options: AnchorPositionOptions = {},
): ResolvedPosition {
    const safe = containedFrame(outlet, frame);
    if (!safe || !outlet) return computeOutletPosition(anchor, floating, outlet, screen, options);
    const p = computeOutletPosition(anchor, floating, safe, screen, options);
    return { ...p, top: p.top + safe.top - outlet.top, left: p.left + safe.left - outlet.left };
}

export interface LynxAnchorPosition {
    /** Bind on the ANCHOR element: `main-thread:ref={anchorRef}`. */
    anchorRef: MainThreadRef<MainThread.Element | null>;
    /** Bind on the FLOATING element: `main-thread:ref={floatingRef}`. */
    floatingRef: MainThreadRef<MainThread.Element | null>;
    /**
     * Wire on the ANCHOR element: `bindlayoutchange={anchorLayoutChange}`.
     * The event payload is IGNORED — it only triggers a measurement (#1080).
     */
    anchorLayoutChange: (event: LayoutChangeEvent) => void;
    /** Wire on the FLOATING element (inside the overlay outlet). */
    floatingLayoutChange: (event: LayoutChangeEvent) => void;
    /**
     * Re-measure the anchor (and the outlet): wire on an open popup's
     * light-dismiss surface as `bindtouchstart`/`bindtouchmove`/
     * `bindtouchend`/`bindtouchcancel`. A pan beside the popup scrolls the
     * page (#1190), and a scroll fires no layout event, so the surface's
     * touch stream is what says "the anchor may be moving"; each event kicks
     * the settle loop, which follows the fling's momentum after the finger
     * lifts until the anchor holds still.
     */
    track: () => void;
    /** The resolved position in OUTLET coordinates, or null until both nodes have measured. */
    position(): ResolvedPosition | null;
    /** The absolute inline style for the floating element. */
    style(): Record<string, string | number>;
}

export interface CreateAnchorPositionOptions extends AnchorPositionOptions {
    /**
     * Whether the popup is open. While it is not, nothing is measured and no
     * settle loop runs: a closed popup has nothing to place, and a screen of
     * closed triggers each re-measuring through a push slide flooded the
     * engine's event limit (#1200). Opening measures the anchor, the popup
     * and the outlet together (the popup's layout event). Default: always
     * open.
     */
    isOpen?: () => boolean;
}

/**
 * The wiring half. Call in component setup; wire BOTH bindings on each
 * element (`main-thread:ref` carries the element to measure,
 * `bindlayoutchange` says when). Position reads are reactive — `style()`
 * recomputes in whatever render or effect reads it once a measurement or
 * the viewport changes.
 */
export function createAnchorPosition(options: CreateAnchorPositionOptions = {}): LynxAnchorPosition {
    const anchor = useViewportRect();
    const floating = useViewportRect();
    // The screen metrics stand in for the viewport: viewport rects and
    // screen metrics share an origin for a full-screen lynx app, they're
    // reactive to rotation, and they need no extra measurement round-trip.
    // Keyboard insets are out of scope here (an anchored popup over a
    // raised keyboard is its own problem).
    const screen = useScreen();
    const origin = useOverlayOriginInjectable();
    const isOpen = options.isOpen ?? (() => true);
    // One measurement of the anchor and the outlet frame. The outlet's
    // `measure` is the same function for every popup under one host, so the
    // shared settle clock measures the frame once per batch, not once per
    // popup (#1200).
    const measureAnchor: ReadonlyArray<() => void> = [anchor.measure, origin.measure];
    // The anchor rides its screen's transform; the popup, in the fixed
    // outlet, does not. Measured mid push-transition, the anchor sits up to
    // a screen width to the right and nothing re-fires once the slide
    // settles — so keep measuring until it stops moving (#1181).
    // A short interval: this also follows a page scrolled under an open
    // popup (`track`), where 100 ms steps read as a stutter.
    //
    // The loop watches the safe frame too, and counts a frame that pokes out
    // of the outlet as moving: that is a push slide pending or under way, and
    // two anchor measurements taken before the slide STARTS agree, which
    // would otherwise end the loop with the anchor a screen width off.
    //
    // Only while OPEN (#1200): a closed popup's loop is off (`read` returns
    // null), and the budget bounds an open one to about two seconds of
    // motion per burst.
    const settle = settleRect(() => (isOpen() ? [anchor.rect.value, origin.frame()] : null), measureAnchor, {
        interval: 32,
        budget: 60,
        unsettled: () => {
            const frame = origin.frame();
            return !!frame && !containedFrame(origin.rect(), frame);
        },
    });

    // An ancestor's transform ending moves the anchor without a layout event
    // (#1233): re-measure once per bump, and only while open. A kick is a
    // handful of batched measurements (`kickTicks`), so a bump costs a
    // bounded burst per open popup, never a loop (#1200).
    const motion = useAncestorMotionInjectable();
    let seenMotion = motion.settled();
    const followMotion = effect(() => {
        const count = motion.settled();
        if (count === seenMotion) return;
        seenMotion = count;
        if (isOpen()) settle.kick();
    });
    onUnmounted(() => followMotion.stop());

    /** The resolved placement, in OUTLET coordinates. */
    const position = (): ResolvedPosition | null => {
        const a = anchor.rect.value;
        const f = floating.rect.value;
        const v = screen.value;
        return a && f && v.width > 0
            ? computeFramedPosition(a, { width: f.width, height: f.height }, origin.rect(), origin.frame(), v, options)
            : null;
    };

    return {
        anchorRef: anchor.ref,
        floatingRef: floating.ref,
        anchorLayoutChange: () => {
            // A closed popup has nothing to place; opening measures anyway.
            if (!isOpen()) return;
            anchor.measure();
            origin.measure();
        },
        floatingLayoutChange: () => {
            // The floating panel measuring means the popup is opening (or its
            // content changed, or it just moved): re-measure the anchor AND
            // the outlet, so all three rects come from the same moment — a
            // layout-time anchor rect goes stale the moment the page scrolls,
            // and an origin measured at mount is stale by a screen width if
            // the screen was sliding in (#1146). A move this causes fires
            // this handler again, so it settles on a consistent triple.
            anchor.measure();
            floating.measure();
            origin.measure();
        },
        track: () => {
            if (isOpen()) settle.kick();
        },
        position,
        style: () => {
            const p = position();
            // `height: max-content`: the outlet layer is 0×0 (#1190), and lynx
            // bounds an absolute child's auto height by its containing block —
            // without it the popup's rows collapse onto one line. Stated on
            // the off-glass spelling too, so the first measurement (which
            // drives the flip) is the real size.
            // Off-glass until measured: painting at 0,0 for one frame reads
            // as a flash in the corner; off-glass reads as "not open yet".
            const at = p ? { top: `${p.top}px`, left: `${p.left}px` } : { top: '-10000px', left: '-10000px' };
            return { position: 'absolute', ...at, height: 'max-content' };
        },
    };
}
