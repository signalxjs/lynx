import {
  component,
  useMainThreadRef,
  runOnBackground,
  Gesture,
  useGestureDetector,
  type Define,
  type MainThread,
} from '@sigx/lynx';

export type PressableProps =
  & Define.Prop<'pressedOpacity', number, false>
  & Define.Prop<'pressedScale', number, false>
  & Define.Prop<'longPressDuration', number, false>
  & Define.Prop<'maxDistance', number, false>
  & Define.Prop<'disabled', boolean, false>
  & Define.Prop<'class', string, false>
  & Define.Prop<'style', Record<string, string | number>, false>
  & Define.Slot<'default'>
  & Define.Event<'press', void>
  & Define.Event<'longPress', void>;

interface PressableMTState {
  longPressFired: boolean;
  pressEmitted: boolean;
  startPageX: number;
  startPageY: number;
}

/**
 * MT-thread tap + long-press recognizer with built-in pressed-state visual
 * feedback (opacity + scale). Press and long-press callbacks are dispatched
 * to BG via `runOnBackground` (low-frequency cross-thread is fine).
 *
 * Cross-platform gesture-arena quirks (Phase 2.12.1, observed on iOS Lynx
 * 3.5 sim and Android Lynx 3.6 / Pixel 9 Pro XL) make this component a
 * hybrid: it composes `Gesture.Tap()` + `Gesture.LongPress()` via
 * `Simultaneous` AND adds an onEnd-fallback path inside LongPress, so press
 * emission works on both platforms via different routes:
 *
 * - **Android**: `Tap.onStart` fires on touch-up (as documented). Press
 *   emits there; the LongPress fallback sees `pressEmitted=true` and
 *   skips. `Tap.onEnd` fires on the same touch-up — but iOS's premature
 *   onEnd (next bullet) means we can't safely reset styles here, so style
 *   reset lives in LongPress.onEnd.
 * - **iOS**: `Tap.onEnd` fires ~6ms after touchstart (an arena
 *   fail/reset path that doesn't trigger on Android). `Tap.onStart`
 *   never fires for our composition. We rely on `LongPress.onEnd` to
 *   detect "lift before duration with no movement" and emit press from
 *   the fallback. `Gesture.Race` would be simpler in theory, but its
 *   `waitFor` deadlocks Tap on iOS — the arena dispatches Tap before
 *   LongPress reaches Fail state.
 *
 * State tracks `longPressFired` and `pressEmitted` so neither event
 * double-fires regardless of which platform path resolves first.
 * Movement past `maxDistance` is tracked from `e.params.pageX/pageY`;
 * `LongPress.onEnd` skips press emission when the touch drifted past
 * the threshold (matching Tap's success criteria).
 *
 * Disabled is captured at setup; runtime toggling won't update an active
 * gesture's behavior. Wrap the parent in conditional rendering for now if
 * dynamic disable is needed.
 */
export const Pressable = component<PressableProps>(({ props, slots, emit }) => {
  const elRef = useMainThreadRef<MainThread.Element | null>(null);

  const opacity = props.pressedOpacity ?? 0.6;
  const scale = props.pressedScale ?? 1;
  // longPressDuration === 0 disables long-press: we set minDuration to a
  // huge value so the platform timer never fires; the iOS press fallback
  // path still works because it's gated on `!longPressFired` (which stays
  // false), and on Android the Tap.onStart path is unaffected.
  const longPressDuration = props.longPressDuration ?? 500;
  const minDuration = longPressDuration > 0 ? longPressDuration : 1_000_000;
  const maxDistance = props.maxDistance ?? 10;
  const maxDistanceSq = maxDistance * maxDistance;
  const disabled = props.disabled ?? false;

  const state = useMainThreadRef<PressableMTState>({
    longPressFired: false,
    pressEmitted: false,
    startPageX: 0,
    startPageY: 0,
  });

  const tap = Gesture.Tap()
    .maxDistance(maxDistance)
    .onBegin((e: any) => {
      'main thread';
      if (disabled) return;
      // Reset the cross-platform state on every fresh touch-down. Both
      // Tap.onBegin and LongPress.onBegin fire — first one wins, second
      // is a no-op because pressEmitted/longPressFired are already false.
      state.current.longPressFired = false;
      state.current.pressEmitted = false;
      const p = e && e.params;
      state.current.startPageX = (p && p.pageX) || 0;
      state.current.startPageY = (p && p.pageY) || 0;
      elRef.current?.setStyleProperties({
        opacity: opacity,
        transform: 'scale(' + scale + ')',
      });
    })
    .onStart(() => {
      'main thread';
      if (disabled) return;
      // Android path: Tap.onStart fires on touchend within maxDuration;
      // emit press here. The LongPress.onEnd fallback below is gated on
      // !pressEmitted so it won't double-fire on Android.
      if (!state.current.pressEmitted) {
        state.current.pressEmitted = true;
        runOnBackground(() => { emit('press'); })();
      }
    });
  // No Tap.onEnd: iOS fires it ~6ms after touchstart (arena fail/reset
  // path), which would prematurely reset our press-state styles. Style
  // reset lives in LongPress.onEnd, which fires only on real touch-up.

  const longPress = Gesture.LongPress()
    .minDuration(minDuration)
    .maxDistance(maxDistance)
    .onBegin(() => {
      'main thread';
      if (disabled) return;
      // Idempotent with Tap.onBegin — both fire on touch-down. State has
      // already been initialised by Tap.onBegin (whichever fires first).
      elRef.current?.setStyleProperties({
        opacity: opacity,
        transform: 'scale(' + scale + ')',
      });
    })
    .onStart(() => {
      'main thread';
      if (disabled) return;
      state.current.longPressFired = true;
      runOnBackground(() => { emit('longPress'); })();
    })
    .onEnd((e: any) => {
      'main thread';
      // Reset visual feedback regardless of how this terminal state was
      // reached (success / fail / cancel / lift-before-duration).
      elRef.current?.setStyleProperties({
        opacity: 1,
        transform: 'scale(1)',
      });
      if (disabled) return;
      // iOS fallback path. On iOS Tap.onStart never fires, so press would
      // never emit without this. On Android this is a no-op because
      // pressEmitted is already true (or longPressFired is true).
      if (state.current.longPressFired || state.current.pressEmitted) return;
      const p = e && e.params;
      if (!p) return;
      const dx = (p.pageX || 0) - state.current.startPageX;
      const dy = (p.pageY || 0) - state.current.startPageY;
      if (dx * dx + dy * dy > maxDistanceSq) return;  // movement-cancel
      state.current.pressEmitted = true;
      runOnBackground(() => { emit('press'); })();
    });

  const gesture = longPressDuration > 0
    ? Gesture.Simultaneous(tap, longPress)
    : tap;

  useGestureDetector(elRef, gesture);

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
