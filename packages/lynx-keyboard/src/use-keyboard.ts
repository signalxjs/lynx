import {
  computed,
  effect,
  onUnmounted,
  runOnMainThread,
  useSharedValue,
  type Computed,
  type SharedValue,
} from '@sigx/lynx';
import { useSafeAreaInsets } from '@sigx/lynx-safe-area';
import { cancelAnimation, withTiming } from '@sigx/lynx-motion';
import type { KeyboardState } from './types.js';

/**
 * BG-reactive soft-keyboard state. The height comes from the safe-area
 * bridge (`useSafeAreaInsets().value.keyboard`, fed by the native
 * `safeAreaChanged` event) — Lynx has no separate keyboard event API.
 * Consumers re-render on keyboard show/hide.
 *
 * Must be used under `<SafeAreaProvider>` (same requirement as every
 * safe-area hook); without one it reads zero insets and warns in dev.
 */
export function useKeyboard(): Computed<KeyboardState> {
  const insets = useSafeAreaInsets();
  return computed(() => {
    const height = insets.value.keyboard;
    return { height, visible: height > 0 };
  });
}

/**
 * BG-reactive "lift" — how far a bottom-anchored bar must rise to clear the
 * keyboard. `max(0, keyboard - bottomInset + offset)` while the keyboard is
 * visible, 0 otherwise. The bottom inset is discounted because an ancestor
 * `<SafeAreaView edges={['bottom']}>` typically already keeps the bar above
 * the home indicator, and the keyboard covers that region when open.
 */
export function useKeyboardLift(
  discountBottomInset = true,
  offset = 0,
): Computed<number> {
  const insets = useSafeAreaInsets();
  return computed(() => {
    const i = insets.value;
    if (i.keyboard <= 0) return 0;
    return Math.max(0, i.keyboard - (discountBottomInset ? i.bottom : 0) + offset);
  });
}

/**
 * Smoothly animated MT SharedValue tracking the keyboard lift, for
 * `useAnimatedStyle(ref, sv, 'translateY', { factor: -1 })` bindings.
 *
 * The keyboard inset is BG-only (deliberately not a SharedValue in
 * lynx-safe-area's provider), so this hook is the BG→MT bridge: a BG effect
 * watches the inset signal and dispatches an MT `withTiming` toward the new
 * target each time it changes. `withTiming` is itself a `'main thread'`
 * worklet, so referencing it from the dispatched worklet survives `_c`
 * capture; the timing loop then runs entirely on MT (no per-frame thread
 * crossing). The watcher effect is stopped on unmount (`effect` comes from
 * `@sigx/reactivity` and is NOT lifecycle-scoped — same manual-stop pattern
 * as lynx-safe-area's provider).
 */

export function useKeyboardLiftSV(
  discountBottomInset = true,
  offset = 0,
  /** Tween duration in seconds (lynx-motion convention). */
  duration = 0.25,
): SharedValue<number> {
  const insets = useSafeAreaInsets();

  const computeLift = (i: { keyboard: number; bottom: number }): number =>
    i.keyboard > 0
      ? Math.max(0, i.keyboard - (discountBottomInset ? i.bottom : 0) + offset)
      : 0;

  // Seed from the CURRENT insets — a screen that mounts while the keyboard
  // is already open (modal presented over a focused composer, back-nav to a
  // focused field) must paint at the lifted position on the first frame,
  // not animate up from 0. Same "correct on first paint" rule as the
  // safe-area provider.
  const initialLift = computeLift(insets.value);
  const lift = useSharedValue(initialLift);

  const animateTo = runOnMainThread((target: number, seconds: number) => {
    'main thread';
    if (seconds <= 0) {
      // Idempotent sync: write the value outright — a zero-delta tween would
      // still schedule rAF ticks for the full duration. Cancel any in-flight
      // tween FIRST: a bare SV write doesn't stop one (lynx-motion contract),
      // so a settle racing a just-dispatched lift tween would otherwise be
      // overwritten by its remaining ticks. MT-side mutation goes through
      // `.current.value` (`.value` is the read-only BG accessor).
      cancelAnimation(lift);
      lift.current.value = target;
      return;
    }
    void withTiming(lift, target, { duration: seconds });
  });

  // Dedupe by last dispatched target: the inset signal also fires for
  // changes that don't affect the lift (rotation, status-bar changes), and
  // animate() doesn't short-circuit zero-delta tweens — it would
  // cancel/restart any in-flight animation. Seeded with the SharedValue's
  // initial value so the mount-frame run dispatches nothing (dispatching
  // during the mount frame can outrun the SV/worklet registration ops).
  let lastTarget = initialLift;
  const watcher = effect(() => {
    const target = computeLift(insets.value);
    if (target === lastTarget) return;
    lastTarget = target;
    void animateTo(target, duration);
  });
  onUnmounted(() => watcher.stop());

  // Post-mount SETTLE (#677): the seed above is read at setup and the
  // watcher dedupes against it, so a keyboard change landing in the gap
  // between those two moments is invisible — BG believes the lift is
  // current while the MT holds the stale seed (the composer's bar stranded
  // keyboard-height off the bottom on first entry). One deferred idempotent
  // sync closes it: re-read the lift AT FIRE TIME and write it outright
  // (duration 0 → direct write, no motion when already correct). Ordering
  // against the SV's registration ops is the runtime's job since #691 —
  // dispatches ride the same ordered ops stream — so a single pass suffices.
  let settleTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    settleTimer = null;
    const target = computeLift(insets.value);
    lastTarget = target;
    void animateTo(target, 0);
  }, 0);
  onUnmounted(() => { if (settleTimer !== null) clearTimeout(settleTimer); });

  return lift;
}
