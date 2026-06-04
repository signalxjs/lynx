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
import { withTiming } from '@sigx/lynx-motion';
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
  const lift = useSharedValue(0);

  const animateTo = runOnMainThread((target: number, seconds: number) => {
    'main thread';
    void withTiming(lift, target, { duration: seconds });
  });

  const watcher = effect(() => {
    const i = insets.value;
    const target = i.keyboard > 0
      ? Math.max(0, i.keyboard - (discountBottomInset ? i.bottom : 0) + offset)
      : 0;
    void animateTo(target, duration);
  });
  onUnmounted(() => watcher.stop());

  return lift;
}
