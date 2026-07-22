/**
 * Viewport-relative element measurement — what anchored/floating surfaces
 * (dropdowns, suggestion popups, tooltips) must use to decide where they fit.
 *
 * ### Why not `useElementLayout`
 *
 * `bindlayoutchange` reports **layout-page** coordinates. They are produced by
 * layout, so they know nothing about what happens after it:
 *
 *  - main-thread transforms (`useAnimatedStyle` translateY — a bottom sheet
 *    riding the keyboard lift, a screen mid-transition),
 *  - scroll offsets,
 *  - `position: fixed` ancestors.
 *
 * A surface that flips/clamps against the screen from those numbers places
 * itself against where the anchor *would* be if nothing moved it — e.g. a
 * suggestion popup deciding there is no room above and flipping down behind
 * the keyboard. `boundingClientRect` is the live, post-transform geometry, so
 * it is the only correct input for that decision.
 *
 * ### The rule
 *
 * Layout events give you SIZE and a "something moved, re-measure" signal.
 * Screen-space geometry comes from here, is re-measured whenever the
 * environment changes (keyboard, layout, orientation), and feeds ONLY the
 * flip/clamp decision — keep the surface itself positioned relative to its
 * container so it rides along with the transform between measurements.
 *
 * ### Cost
 *
 * The measurement is an async UI-method call on the main thread, so the rect
 * lands a frame or two after `measure()`. Measure eagerly (when the surface is
 * about to open), not in a render path, and keep the layout frame as the
 * first-paint fallback.
 *
 * The rect travels back over the SharedValue bridge (`useSharedValue`), which
 * is the MT → BG channel a `runOnMainThread` worklet has: its dispatch op
 * carries captures only — no `runOnBackground` handle — so calling
 * `runOnBackground` inside one is a build-time trap, not an option.
 *
 * @example
 * ```tsx
 * const { ref, rect, measure } = useViewportRect();
 *
 * return () => (
 *   <view main-thread:ref={ref} bindlayoutchange={() => measure()}>
 *     …
 *   </view>
 * );
 * ```
 */

import { useMainThreadRef, type MainThreadRef } from './main-thread-ref.js';
import { useSharedValue, type SharedValue } from './animated/shared-value.js';
import { runOnMainThread } from './threading.js';
import type { ElementLayout } from './use-element-layout.js';
import type { MainThread } from './jsx.js';

/**
 * An element's live rect **relative to the viewport**, transforms included.
 * Same field set as {@link ElementLayout} (which is page-relative and
 * transform-blind) — the difference is the coordinate space, not the shape.
 */
export type ViewportRect = ElementLayout;

/** Raw `boundingClientRect` payload (only the fields we normalize). */
interface RectPayload {
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
    width?: number;
    height?: number;
}

/**
 * Measure `el`'s viewport rect from a main-thread context and hand it to
 * `apply` — `null` when the element is missing or the UI method is
 * unavailable, so callers always get an answer and can fall back.
 *
 * `androidEnableTransformProps` is what makes the result transform-aware on
 * Android (Lynx leaves transforms out of the rect without it); iOS reports
 * post-transform geometry either way.
 *
 * Call it directly from main-thread handlers that already have the element
 * (a tap that opens a menu), or use {@link useViewportRect} from the
 * background thread.
 */
export function measureViewportRect(
    el: MainThread.Element | null,
    apply: (rect: ViewportRect | null) => void,
): void {
    'main thread';
    if (!el) {
        apply(null);
        return;
    }
    const normalize = (value: unknown): ViewportRect | null => {
        if (!value || typeof value !== 'object') return null;
        const r = value as RectPayload;
        const left = r.left ?? 0;
        const top = r.top ?? 0;
        const width = r.width ?? 0;
        const height = r.height ?? 0;
        return {
            left,
            top,
            width,
            height,
            right: r.right ?? left + width,
            bottom: r.bottom ?? top + height,
        };
    };
    let result: unknown;
    try {
        result = el.invoke('boundingClientRect', { androidEnableTransformProps: true });
    } catch {
        // UI method unsupported on this element/engine — the caller falls back.
        apply(null);
        return;
    }
    if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).then(
            (rect) => apply(normalize(rect)),
            () => apply(null),
        );
        return;
    }
    // Older engines resolved the method synchronously.
    apply(normalize(result));
}

export interface UseViewportRectResult {
    /** Bind on the element to measure: `main-thread:ref={ref}`. */
    ref: MainThreadRef<MainThread.Element | null>;
    /**
     * Latest measured rect — read `rect.value` on the background thread, the
     * same way `useElementLayout`'s `layout.value` is read. `null` until the
     * first measurement lands. Reads are reactive: a render or `effect` that
     * touches it re-runs when a new measurement publishes.
     */
    rect: SharedValue<ViewportRect | null>;
    /** Request a measurement. Cheap to call from a chatty signal (`bindlayoutchange`). */
    measure: () => void;
}

/**
 * Background-thread access to an element's live viewport rect: bind `ref`,
 * call `measure()` when something moved, read `rect.value` when placing.
 *
 * The measurement hops BG → MT (the element handle and the UI method are
 * main-thread-only) and the rect comes back over the SharedValue bridge — the
 * only MT → BG data channel for a `runOnMainThread` worklet, since the
 * dispatch op carries no `runOnBackground` handle (worklet return values
 * don't cross threads either; see `threading.ts`). So `rect.value` stays
 * `null` for the first frame(s) after mount — render against the layout frame
 * until it arrives rather than gating the surface on it.
 */
export function useViewportRect(): UseViewportRectResult {
    const ref = useMainThreadRef<MainThread.Element | null>(null);
    const rect = useSharedValue<ViewportRect | null>(null);

    const dispatch = runOnMainThread(() => {
        'main thread';
        measureViewportRect(ref.current, (measured: ViewportRect | null) => {
            // A failed measurement keeps the last good rect: a stale anchor
            // still places better than none.
            if (measured) rect.current.value = measured;
        });
    });

    // The dispatch rejects on hosts without the worklet transform (tests,
    // non-Lynx) — swallow it so a caller never has to guard the call.
    const measure = (): void => { void dispatch().catch(() => {}); };

    return { ref, rect, measure };
}
