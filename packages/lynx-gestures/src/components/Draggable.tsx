import {
  component,
  measureViewportRect,
  useMainThreadRef,
  useSharedValue,
  useAnimatedStyle,
  runOnBackground,
  Gesture,
  useGestureDetector,
  type SharedValue,
  type Define,
  type MainThread,
  type ViewportRect,
} from '@sigx/lynx';
import { useScrollContext } from '../scroll-context.js';

export interface DragEndDetail {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Edge-scroll configuration for `<Draggable edgeScroll>`. Either `true` for
 * default tuning, or an object overriding the defaults.
 */
export type EdgeScrollConfig = boolean | {
  /** Distance from viewport edge in pt where auto-scroll engages. Default 50. */
  threshold?: number;
  /** Maximum scroll velocity in pt/sec at the edge. Default 800. */
  maxSpeed?: number;
};

export type DraggableProps =
  & Define.Prop<'axis', 'x' | 'y' | 'both', false>
  & Define.Prop<'threshold', number, false>
  & Define.Prop<'snapBack', boolean, false>
  & Define.Prop<'minX', number, false>
  & Define.Prop<'maxX', number, false>
  & Define.Prop<'minY', number, false>
  & Define.Prop<'maxY', number, false>
  & Define.Prop<'translateX', SharedValue<number>, false>
  & Define.Prop<'translateY', SharedValue<number>, false>
  & Define.Prop<'edgeScroll', EdgeScrollConfig, false>
  & Define.Prop<'class', string, false>
  & Define.Prop<'style', Record<string, string | number>, false>
  & Define.Slot<'default'>
  & Define.Event<'dragStart', { x: number; y: number }>
  & Define.Event<'dragEnd', DragEndDetail>;

interface DragMTState {
  startPageX: number;
  startPageY: number;
  offsetX: number;
  offsetY: number;
  prevPageX: number;
  prevPageY: number;
  prevTime: number;
  vx: number;
  vy: number;
  // Phase 2.13 edge-scroll state. Populated lazily in onStart when edgeScroll
  // is enabled and a parent ScrollView is in scope. Read by the rAF tick
  // closure scheduled from onUpdate.
  lastPageX: number;
  lastPageY: number;
  scrollViewLeft: number;
  scrollViewTop: number;
  scrollViewWidth: number;
  scrollViewHeight: number;
  edgeScrollActive: boolean;
  /**
   * Last observed parent ScrollView offset, sampled inside the rAF tick.
   * Used to compute the *actual* scroll delta between frames so the
   * compensation matches what the native scroll-view delivered (zero when
   * it clamped at top/bottom). Without this, holding past the top edge
   * keeps adding negative delta to ty even though the page can't scroll
   * any further, drifting the box off-screen.
   */
  lastScrollX: number;
  lastScrollY: number;
}

/**
 * MT-thread draggable container, built on the native gesture arena via
 * `Gesture.Pan()`. The bound element's transform is driven by two
 * `useAnimatedStyle` bindings (one per axis) — the same primitive any user
 * could compose. The Pan onUpdate worklet writes to the SharedValues; the
 * bridge applies the transform on the next flush boundary, composing the
 * two bindings into a single `setStyleProperties({ transform })` call.
 *
 * Because the visible position is bridge-driven rather than written directly
 * by the worklet, external animation of `translateX`/`translateY` (e.g.
 * `withSpring(tx, 0)` to spring back to origin after release) moves the
 * element visually for free — the binding picks up whichever SV write
 * happened most recently, regardless of who wrote it.
 *
 * `dragStart` and `dragEnd` are dispatched to BG via `runOnBackground` (low
 * frequency, cross-thread is fine).
 *
 * Unlike the prior `bindtouch*`-based implementation, the native pan gesture
 * arena handles multi-touch correctly (secondary fingers don't cancel the
 * primary drag).
 *
 * **Scroll composition** (Phase 2.12.3): Lynx's `<scroll-view>` doesn't
 * participate in the new gesture arena, so without coordination both pan
 * and scroll would fire concurrently. `<Draggable>` reads `useScrollContext`
 * at setup; if a parent `<ScrollView>` is in scope, the BG-side dragStart/
 * dragEnd flips `scrollCtx.dragging` automatically — the parent's
 * `enable-scroll` is gated on that signal, so the UIKit pan recognizer
 * yields for the duration of the drag. No consumer wiring required.
 *
 * **Edge-scroll** (Phase 2.13): pass `edgeScroll` to auto-scroll the parent
 * `<ScrollView>` when the finger nears its viewport edge during a drag —
 * the standard drag-to-reorder pattern (Apple Mail, iOS Reminders). The
 * scroll axis follows `scrollOrientation` as published through the context.
 * Inside the threshold zone the scroll velocity ramps from 0 at the
 * threshold boundary to `maxSpeed` at the edge. Quietly no-ops if
 * `edgeScroll` is unset OR the Draggable isn't nested in a ScrollView.
 *
 * Note on the native event payload: Lynx's pan handler emits `pageX`/`pageY`
 * but no `translationX`/`velocityX` — we compute deltas and velocity from
 * pageX/pageY ourselves (same as the prior touch-based implementation).
 */
export const Draggable = component<DraggableProps>(({ props, slots, emit }) => {
  const elRef = useMainThreadRef<MainThread.Element | null>(null);

  // Always allocate fallback SharedValues — hooks must run unconditionally.
  const ownTx = useSharedValue(0);
  const ownTy = useSharedValue(0);

  // Pick once at setup so useAnimatedStyle bindings + worklet `_c` captures
  // hold stable refs. Convention (also used by <ScrollView>): gesture-prop
  // SVs are allocated once at the parent and don't swap across renders.
  const tx = props.translateX ?? ownTx;
  const ty = props.translateY ?? ownTy;

  // Bridge tx/ty → element transform on every flush boundary. Composes with
  // any external animation that mutates the same SVs.
  useAnimatedStyle(elRef, tx, 'translateX');
  useAnimatedStyle(elRef, ty, 'translateY');

  const drag = useMainThreadRef<DragMTState>({
    startPageX: 0, startPageY: 0,
    offsetX: 0, offsetY: 0,
    prevPageX: 0, prevPageY: 0, prevTime: 0,
    vx: 0, vy: 0,
    lastPageX: 0, lastPageY: 0,
    scrollViewLeft: 0, scrollViewTop: 0,
    scrollViewWidth: 0, scrollViewHeight: 0,
    edgeScrollActive: false,
    lastScrollX: 0, lastScrollY: 0,
  });

  // Coordinate with the parent <ScrollView> (Phase 2.12.3): toggle its
  // dragging signal during our gesture so its UIScrollView pan recognizer
  // yields. Null when no ancestor ScrollView; the BG arrows below null-check.
  const scrollCtx = useScrollContext();

  // Pan config is read once at setup. Worklet bodies capture the snapshot
  // via SWC's `_c` mechanism; runtime prop changes won't update an active
  // gesture, but axis/threshold/clamps are render-stable in practice.
  const axis = props.axis ?? 'both';
  const threshold = props.threshold ?? 0;
  const snapBack = props.snapBack ?? false;
  const minX = props.minX;
  const maxX = props.maxX;
  const minY = props.minY;
  const maxY = props.maxY;

  // Phase 2.13: edge-scroll config. Normalized to plain numbers/booleans so
  // worklet `_c` captures stay shape-stable. `edgeScrollEnabled` gates the
  // viewport-measurement and rAF-tick paths in onStart/onUpdate; falsey
  // means the new code paths short-circuit and behave identically to the
  // pre-2.13 Draggable. `??` (not `||`) so an explicit `0` override for the
  // edge zone or speed cap is preserved.
  const edgeScrollProp = props.edgeScroll ?? false;
  const edgeScrollEnabled = edgeScrollProp !== false;
  const edgeScrollThreshold =
    (typeof edgeScrollProp === 'object' ? edgeScrollProp.threshold : undefined) ?? 50;
  const edgeScrollMaxSpeed =
    (typeof edgeScrollProp === 'object' ? edgeScrollProp.maxSpeed : undefined) ?? 800;
  // Captured at setup so the onUpdate tick reads a stable axis. `<ScrollView>`
  // captures `scroll-orientation` once at setup too, so this stays consistent.
  const scrollOrientation: 'vertical' | 'horizontal' = scrollCtx?.scrollOrientation ?? 'vertical';

  const pan = Gesture.Pan()
    .minDistance(threshold)
    // Empty onBegin is load-bearing on iOS: LynxPanGestureHandler bails out
    // of onStart/onEnd unless `_isInvokedBegin` is YES, and that flag is
    // only set inside the native onBegin handler — which itself short-
    // circuits when no callback is registered. Registering any onBegin
    // (even a no-op) gates the begin path open so onStart and onEnd fire.
    .onBegin(() => {
      'main thread';
    })
    .onStart((e: any) => {
      'main thread';
      // Pan event payload: { type, timestamp, target, currentTarget,
      //                      params: { pageX, pageY, x, y, clientX, clientY,
      //                                scrollX, scrollY, isAtStart, isAtEnd,
      //                                type } , detail: <copy of params> }
      // pageX/pageY are nested under params; the top-level event has only
      // dispatch metadata.
      const p = e && e.params;
      const pageX = (p && p.pageX) || 0;
      const pageY = (p && p.pageY) || 0;
      drag.current.startPageX = pageX;
      drag.current.startPageY = pageY;
      drag.current.offsetX = tx.current.value;
      drag.current.offsetY = ty.current.value;
      drag.current.prevPageX = pageX;
      drag.current.prevPageY = pageY;
      drag.current.prevTime = Date.now();
      drag.current.vx = 0;
      drag.current.vy = 0;
      drag.current.lastPageX = pageX;
      drag.current.lastPageY = pageY;
      drag.current.edgeScrollActive = false;
      // Lazy viewport measurement for edge-scroll. Measures the parent
      // <scroll-view> via the ref the context publishes.
      if (edgeScrollEnabled && scrollCtx) {
        const svRef = scrollCtx.scrollViewRef.current;
        if (svRef) {
          // `measureViewportRect` over `getComputedStyleProperty`: it returns
          // viewport geometry that's consistent across iOS + Android and
          // accounts for transforms. `getComputedStyleProperty('height')`
          // sometimes returns unresolved `100vh`-style strings or content
          // heights on Android, which made the bottom-edge zone unreachable
          // on Pixel.
          //
          // The measurement is async — the rect lands a tick or two after
          // this call, so the first few onUpdate frames may see
          // scrollView{Width,Height}=0 and skip the rAF schedule. By the
          // time the user has dragged anywhere meaningful, the rect is
          // populated and edge-scroll engages.
          measureViewportRect(svRef, (rect: ViewportRect | null) => {
            if (!rect) return;
            drag.current.scrollViewLeft = rect.left;
            drag.current.scrollViewTop = rect.top;
            drag.current.scrollViewWidth = rect.width;
            drag.current.scrollViewHeight = rect.height;
          });
        }
        // Seed last-known scroll offsets so the first tick's "actual delta"
        // baselines correctly. After the first frame, the rAF tick keeps
        // these in sync with the live offsetX/Y SVs.
        drag.current.lastScrollX = scrollCtx.offsetX.current.value;
        drag.current.lastScrollY = scrollCtx.offsetY.current.value;
      }
      runOnBackground((startX: number, startY: number) => {
        if (scrollCtx) scrollCtx.dragging.value = true;
        emit('dragStart', { x: startX, y: startY });
      })(tx.current.value, ty.current.value);
    })
    .onUpdate((e: any) => {
      'main thread';
      const p = e && e.params;
      const pageX = (p && p.pageX) || 0;
      const pageY = (p && p.pageY) || 0;
      let dx = pageX - drag.current.startPageX;
      let dy = pageY - drag.current.startPageY;
      if (axis === 'x') dy = 0;
      else if (axis === 'y') dx = 0;
      let newX = drag.current.offsetX + dx;
      let newY = drag.current.offsetY + dy;
      if (minX !== undefined && newX < minX) newX = minX;
      if (maxX !== undefined && newX > maxX) newX = maxX;
      if (minY !== undefined && newY < minY) newY = minY;
      if (maxY !== undefined && newY > maxY) newY = maxY;
      const now = Date.now();
      const dt = Math.max(now - drag.current.prevTime, 1);
      drag.current.vx = (pageX - drag.current.prevPageX) / dt;
      drag.current.vy = (pageY - drag.current.prevPageY) / dt;
      drag.current.prevPageX = pageX;
      drag.current.prevPageY = pageY;
      drag.current.prevTime = now;
      drag.current.lastPageX = pageX;
      drag.current.lastPageY = pageY;
      tx.current.value = newX;
      ty.current.value = newY;
      // Drive the useAnimatedStyle bindings on the same frame. Inlined
      // (rather than calling an imported helper) because plain function
      // imports don't survive worklet `_c` capture — same constraint as
      // <ScrollView> and @sigx/lynx-motion's animate().
      const __flush = (globalThis as Record<string, unknown>)['__FlushElementTree'] as (() => void) | undefined;
      if (__flush) __flush();
      // Phase 2.13 edge-scroll: enter the rAF loop when the finger crosses
      // into the threshold zone. The tick closure self-cancels when
      // `edgeScrollActive` flips false (onEnd) or the finger leaves the
      // zone (zero velocity).
      if (edgeScrollEnabled && scrollCtx && !drag.current.edgeScrollActive) {
        const w = drag.current.scrollViewWidth;
        const h = drag.current.scrollViewHeight;
        if (w > 0 && h > 0) {
          let inEdge = false;
          if (scrollOrientation === 'vertical') {
            const top = drag.current.scrollViewTop;
            const py = drag.current.lastPageY;
            const topDist = py - top;
            const botDist = (top + h) - py;
            inEdge = topDist < edgeScrollThreshold || botDist < edgeScrollThreshold;
          } else {
            const left = drag.current.scrollViewLeft;
            const px = drag.current.lastPageX;
            const leftDist = px - left;
            const rightDist = (left + w) - px;
            inEdge = leftDist < edgeScrollThreshold || rightDist < edgeScrollThreshold;
          }
          if (inEdge) {
            drag.current.edgeScrollActive = true;
            // Inner arrow runs on MT (we're already inside an MT worklet
            // body); rAF stashes the closure across frames in the MT VM.
            // No `'main thread'` directive needed — the directive marks
            // function bodies that cross threads, and we never leave MT.
            const tick = (): void => {
              if (!drag.current.edgeScrollActive) return;
              const ref = scrollCtx.scrollViewRef.current;
              if (!ref) {
                drag.current.edgeScrollActive = false;
                return;
              }
              let velocity = 0;
              if (scrollOrientation === 'vertical') {
                const py2 = drag.current.lastPageY;
                const top2 = drag.current.scrollViewTop;
                const h2 = drag.current.scrollViewHeight;
                const topDist2 = py2 - top2;
                const botDist2 = (top2 + h2) - py2;
                if (topDist2 < edgeScrollThreshold) {
                  const t = topDist2 < 0 ? 0 : topDist2;
                  velocity = -edgeScrollMaxSpeed * (1 - t / edgeScrollThreshold);
                } else if (botDist2 < edgeScrollThreshold) {
                  const t = botDist2 < 0 ? 0 : botDist2;
                  velocity = edgeScrollMaxSpeed * (1 - t / edgeScrollThreshold);
                }
              } else {
                const px2 = drag.current.lastPageX;
                const left2 = drag.current.scrollViewLeft;
                const w2 = drag.current.scrollViewWidth;
                const leftDist2 = px2 - left2;
                const rightDist2 = (left2 + w2) - px2;
                if (leftDist2 < edgeScrollThreshold) {
                  const t = leftDist2 < 0 ? 0 : leftDist2;
                  velocity = -edgeScrollMaxSpeed * (1 - t / edgeScrollThreshold);
                } else if (rightDist2 < edgeScrollThreshold) {
                  const t = rightDist2 < 0 ? 0 : rightDist2;
                  velocity = edgeScrollMaxSpeed * (1 - t / edgeScrollThreshold);
                }
              }
              if (velocity === 0) {
                drag.current.edgeScrollActive = false;
                return;
              }
              // Scroll-delta compensation: when content scrolls by `delta`,
              // the Draggable's layout position moves by `-delta` (it's a
              // child of the content). Without compensation the box drifts
              // away from the finger as the page scrolls.
              //
              // We use the *actual* delivered scroll delta (read from
              // offsetX/Y the bindscroll worklet maintains), not the
              // velocity-based request. When the scroll-view clamps at the
              // top/bottom (already at the edge), the actual delta is zero
              // and we skip compensation — otherwise the box would keep
              // drifting off-screen as we issue scrollBy calls the native
              // side rejects.
              //
              // There's a one-frame lag (this tick reads the previous
              // frame's actual delta), but it's imperceptible at 60fps.
              const currScrollX = scrollCtx.offsetX.current.value;
              const currScrollY = scrollCtx.offsetY.current.value;
              const actualDX = currScrollX - drag.current.lastScrollX;
              const actualDY = currScrollY - drag.current.lastScrollY;
              drag.current.lastScrollX = currScrollX;
              drag.current.lastScrollY = currScrollY;
              if (scrollOrientation === 'vertical') {
                if (actualDY !== 0) {
                  drag.current.offsetY += actualDY;
                  ty.current.value += actualDY;
                }
              } else {
                if (actualDX !== 0) {
                  drag.current.offsetX += actualDX;
                  tx.current.value += actualDX;
                }
              }
              // 60 fps tick → offset (pt/frame) = velocity (pt/sec) / 60.
              // scrollBy on a vertical scroll-view ignores the X component
              // of the offset (and vice-versa per
              // LynxUIScrollViewInternal.m:269), so a single signed
              // `offset` works for both axes.
              //
              // `invoke()` already calls `__FlushElementTree()` internally
              // (`MTElementWrapper.invoke` sequences `__InvokeUIMethod` →
              // `__FlushElementTree` synchronously inside the Promise
              // constructor), which picks up the SV write above. No
              // explicit flush needed — adding one would double the
              // per-frame work and contributes to scroll stutter.
              const delta = velocity / 60;
              const p2 = ref.invoke('scrollBy', { offset: delta });
              if (p2 && typeof p2.catch === 'function') p2.catch(() => {});
              const raf = (globalThis as Record<string, unknown>)['requestAnimationFrame'] as
                ((cb: () => void) => void) | undefined;
              if (raf) raf(tick);
              else drag.current.edgeScrollActive = false;
            };
            const raf = (globalThis as Record<string, unknown>)['requestAnimationFrame'] as
              ((cb: () => void) => void) | undefined;
            if (raf) raf(tick);
            else drag.current.edgeScrollActive = false;
          }
        }
      }
    })
    .onEnd(() => {
      'main thread';
      // Stop the edge-scroll rAF loop (if any). The tick self-cancels next
      // frame on the flag flip.
      drag.current.edgeScrollActive = false;
      if (snapBack) {
        tx.current.value = 0;
        ty.current.value = 0;
        const __flush = (globalThis as Record<string, unknown>)['__FlushElementTree'] as (() => void) | undefined;
        if (__flush) __flush();
      }
      // Capture MT values into locals before crossing back to BG —
      // `tx.current.value` on the BG side reads the initial snapshot, not
      // the live drag position. Same goes for `drag.current.vx/vy`.
      const endX = tx.current.value;
      const endY = ty.current.value;
      const endVx = drag.current.vx;
      const endVy = drag.current.vy;
      runOnBackground((x: number, y: number, vx: number, vy: number) => {
        if (scrollCtx) scrollCtx.dragging.value = false;
        emit('dragEnd', { x, y, vx, vy });
      })(endX, endY, endVx, endVy);
    });

  useGestureDetector(elRef, pan);

  return () => (
    <view
      class={props.class}
      style={props.style}
      main-thread:ref={elRef}
    >
      {slots.default?.()}
    </view>
  );
});
