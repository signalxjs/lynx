import {
  defineInjectable,
  type PrimitiveSignal,
  type SharedValue,
  type MainThreadRef,
  type MainThread,
} from '@sigx/lynx';

/**
 * Scroll-arena coordination context, provided by `<ScrollView>` and consumed
 * by descendant gesture components (`<Draggable>`, `<Swipeable>`).
 *
 * Why this exists: Lynx's `<scroll-view>` does NOT participate in the new
 * gesture arena (`LynxGestureArenaManager`) on iOS — its UIKit
 * `panGestureRecognizer` runs independently of arena gestures, so a Pan
 * registered on a descendant element fires concurrently with the parent
 * scroll. The visible result is "drag works but the page scrolls too,
 * sliding the box away from the finger".
 *
 * Workaround: the parent `<ScrollView>` exposes a BG-side `dragging` signal
 * that gates its `enable-scroll` prop. Gesture children flip the signal
 * during their lifecycle (onStart/onEnd → onDragStart/onDragEnd) so the
 * UIScrollView pan recognizer is disabled while a child gesture owns the
 * touch.
 *
 * This is a Phase 2.12 framework-level encapsulation of what consumers had
 * to wire by hand in Phase 2.11. A proper fix lives on the Lynx native
 * side: making `<scroll-view>`'s pan recognizer participate in the arena
 * (or yielding to arena recognizers in `shouldBeRequiredToFailByGestureRecognizer:`).
 * Until then, this is the cleanest the framework can be.
 *
 * Returns `null` when no parent `<ScrollView>` is in scope, so consumers
 * branch on presence:
 *
 * ```ts
 * const scrollCtx = useScrollContext();
 * // ... inside an onStart's runOnBackground arrow:
 * if (scrollCtx) scrollCtx.dragging.value = true;
 * ```
 *
 * Phase 2.13 extends the context with the scroll-view's element ref + live
 * scroll-position SVs + axis, so descendants can drive scroll directly
 * (edge-scroll while dragging, etc.) without re-piping refs through props.
 */
export interface ScrollContext {
  /** BG-side flag the parent `<ScrollView>` reads as `enable-scroll={!dragging.value}`. */
  dragging: PrimitiveSignal<boolean>;
  /**
   * MT element ref to the underlying `<scroll-view>`. Null until mounted.
   * Descendants call `scrollViewRef.current?.invoke('scrollBy', ...)` from
   * worklets to drive scroll programmatically.
   */
  scrollViewRef: MainThreadRef<MainThread.Element | null>;
  /**
   * Live horizontal scroll position. Same SV the consumer passes via
   * `<ScrollView offsetX={…}>` (or an internally-allocated fallback).
   */
  offsetX: SharedValue<number>;
  /**
   * Live vertical scroll position. Same SV the consumer passes via
   * `<ScrollView offsetY={…}>` (or an internally-allocated fallback).
   */
  offsetY: SharedValue<number>;
  /**
   * Scroll axis as configured on the `<scroll-view>`. Edge-scroll
   * descendants pick which edges to monitor based on this:
   * `'vertical'` → top/bottom; `'horizontal'` → left/right.
   */
  scrollOrientation: 'vertical' | 'horizontal';
}

export const useScrollContext = defineInjectable<ScrollContext | null>(() => null);
