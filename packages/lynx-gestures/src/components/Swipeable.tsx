import {
  component,
  useMainThreadRef,
  useSharedValue,
  useAnimatedStyle,
  runOnBackground,
  Gesture,
  useGestureDetector,
  type Define,
  type MainThread,
} from '@sigx/lynx';
import { useScrollContext } from '../scroll-context.js';

export type SwipeSide = 'left' | 'right';

export type SwipeableProps =
  & Define.Prop<'leftActionsWidth', number, false>
  & Define.Prop<'rightActionsWidth', number, false>
  & Define.Prop<'snapThreshold', number, false>
  & Define.Prop<'snapDuration', number, false>
  & Define.Prop<'leftActions', () => unknown, false>
  & Define.Prop<'rightActions', () => unknown, false>
  & Define.Prop<'class', string, false>
  & Define.Prop<'style', Record<string, string | number>, false>
  & Define.Prop<'foregroundStyle', Record<string, string | number>, false>
  & Define.Slot<'default'>
  & Define.Event<'swipeOpen', { side: SwipeSide }>
  & Define.Event<'swipeClose', void>;

interface SwipeMTState {
  startPageX: number;
  offsetX: number;
  /** Snapped resting position: 0, +leftWidth, or -rightWidth. */
  currentX: number;
}

/**
 * Horizontal swipe-to-reveal container, built on the native gesture arena
 * via `Gesture.Pan().axis('x')`. The foreground is dragged horizontally on
 * the MT thread; on release it snaps to one of three resting positions
 * (closed / open-left / open-right) using `MTElementWrapper.animate()`.
 * Open and close events are dispatched to BG via `runOnBackground`.
 *
 * Migrated from a 4-`bindtouch*`-worklet implementation to a single
 * `Gesture.Pan()` (Phase 2.12). Carries the same Phase 2.11 quirks:
 *   - `.onBegin(() => {})` no-op is load-bearing on iOS Pan to gate
 *     `_isInvokedBegin` open so onStart/onEnd fire.
 *   - `e.params.pageX` (not `e.pageX`) — Lynx pan event nests the touch
 *     payload under `params`.
 *
 * Supply `leftActions` and/or `rightActions` as render-prop functions:
 *
 * ```tsx
 * <Swipeable
 *   rightActions={() => <view><text>Delete</text></view>}
 *   onSwipeOpen={(e) => console.log('opened', e.side)}
 * >
 *   <view><text>Row content</text></view>
 * </Swipeable>
 * ```
 *
 * **Scroll composition** (Phase 2.12.3): nesting `<Swipeable>` inside
 * `<ScrollView>` is automatic — `useScrollContext` is read at setup and
 * the BG-side onStart/onEnd handlers flip `scrollCtx.dragging` so the
 * parent yields its UIKit pan for the duration of the swipe. No consumer
 * wiring required.
 */
export const Swipeable = component<SwipeableProps>(({ props, slots, emit }) => {
  const fgRef = useMainThreadRef<MainThread.Element | null>(null);

  // Drive the foreground transform via a SharedValue so external animations
  // could compose if we ever wanted spring snaps. For now we still call
  // `.animate()` on the element directly for the snap; the SV is only the
  // intermediate write target during the drag.
  const tx = useSharedValue(0);
  useAnimatedStyle(fgRef, tx, 'translateX');

  const drag = useMainThreadRef<SwipeMTState>({
    startPageX: 0,
    offsetX: 0,
    currentX: 0,
  });

  // Coordinate with the parent <ScrollView> (Phase 2.12.3) — see Draggable
  // for the why. Null when no ancestor ScrollView.
  const scrollCtx = useScrollContext();

  const leftWidth = props.leftActionsWidth ?? 100;
  const rightWidth = props.rightActionsWidth ?? 100;
  const snapThreshold = props.snapThreshold ?? 60;
  const snapDuration = props.snapDuration ?? 200;
  const hasLeft = !!props.leftActions;
  const hasRight = !!props.rightActions;
  const upper = hasLeft ? leftWidth : 0;
  const lower = hasRight ? -rightWidth : 0;

  const pan = Gesture.Pan()
    .axis('x')
    // Empty onBegin gates `_isInvokedBegin` open on iOS so onStart/onEnd fire.
    .onBegin(() => {
      'main thread';
    })
    .onStart((e: any) => {
      'main thread';
      const p = e && e.params;
      drag.current.startPageX = (p && p.pageX) || 0;
      drag.current.offsetX = drag.current.currentX;
      // Tell the parent ScrollView (if any) we own the touch.
      runOnBackground(() => {
        if (scrollCtx) scrollCtx.dragging.value = true;
      })();
    })
    .onUpdate((e: any) => {
      'main thread';
      const p = e && e.params;
      const pageX = (p && p.pageX) || 0;
      let x = drag.current.offsetX + (pageX - drag.current.startPageX);
      if (x > upper) x = upper;
      if (x < lower) x = lower;
      tx.current.value = x;
      // Bridge the binding on the same frame so the foreground tracks the
      // finger without a vsync delay (same trick as Draggable).
      const __flush = (globalThis as Record<string, unknown>)['__FlushElementTree'] as (() => void) | undefined;
      if (__flush) __flush();
    })
    .onEnd(() => {
      'main thread';
      const x = tx.current.value;
      // Snap to closest resting position.
      let target = 0;
      if (hasLeft && x > snapThreshold) target = leftWidth;
      else if (hasRight && x < -snapThreshold) target = -rightWidth;
      fgRef.current?.animate(
        [
          { transform: 'translateX(' + x + 'px)' },
          { transform: 'translateX(' + target + 'px)' },
        ],
        { duration: snapDuration, fill: 'forwards', easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      )?.play();
      // Keep the SV in sync with the snap target so subsequent drags don't
      // jump back to the pre-animate position.
      tx.current.value = target;
      const wasOpen = drag.current.currentX !== 0;
      const nowOpen = target !== 0;
      drag.current.currentX = target;
      // Always release the parent ScrollView's claim, regardless of snap.
      // Bundled into the same runOnBackground call as the emit so we only
      // pay one cross-thread hop.
      if (nowOpen) {
        const side: SwipeSide = target > 0 ? 'left' : 'right';
        runOnBackground((s: SwipeSide) => {
          if (scrollCtx) scrollCtx.dragging.value = false;
          emit('swipeOpen', { side: s });
        })(side);
      } else if (wasOpen) {
        runOnBackground(() => {
          if (scrollCtx) scrollCtx.dragging.value = false;
          emit('swipeClose');
        })();
      } else {
        // Closed→closed: still need to release the ScrollView claim.
        runOnBackground(() => {
          if (scrollCtx) scrollCtx.dragging.value = false;
        })();
      }
    });

  useGestureDetector(fgRef, pan);

  return () => (
    <view
      class={props.class}
      style={{
        position: 'relative',
        overflow: 'hidden',
        ...(props.style || {}),
      }}
    >
      {hasLeft ? (
        <view style={{
          position: 'absolute',
          left: '0',
          top: '0',
          bottom: '0',
          width: leftWidth + 'px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {props.leftActions!()}
        </view>
      ) : null}

      {hasRight ? (
        <view style={{
          position: 'absolute',
          right: '0',
          top: '0',
          bottom: '0',
          width: rightWidth + 'px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {props.rightActions!()}
        </view>
      ) : null}

      <view
        main-thread:ref={fgRef}
        style={{
          position: 'relative',
          ...(props.foregroundStyle || {}),
        }}
      >
        {slots.default?.()}
      </view>
    </view>
  );
});
