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
import { loadString, saveString } from './persistence.js';
import type { KeyboardState } from './types.js';

/**
 * The most recently observed keyboard lift (px, inset-discounted), 0 until
 * a keyboard has ever been shown.
 *
 * Module-level ON PURPOSE: "how tall is this device's keyboard" is a fact
 * about the app's environment, not about whichever component happened to be
 * mounted when it last appeared. A panel that must occupy exactly the
 * keyboard's space — a WhatsApp-style emoji sheet — otherwise has to guess a
 * fallback the first time it opens on a screen where nothing has been typed
 * yet, and then visibly corrects itself when the real keyboard returns (#811:
 * the composer's input row jumped 53 px on that first swap).
 *
 * Only the DEFAULT lift shape (bottom inset discounted, no offset) is
 * recorded, so the number means one thing. It also PERSISTS across app runs
 * (via the optional `@sigx/lynx-storage` peer — without it the memory is
 * simply per-run), so a fresh launch is right from the first panel.
 */
let observedLift = 0;
/** Whether `observedLift` came from a REAL keyboard this run (vs. restored). */
let observedThisRun = false;
/** Last value written to storage — dedupes redundant writes. */
let persisted: string | null = null;

const STORAGE_KEY = 'sigx.keyboard.lift';

// Restore last run's height so the FIRST keyboard-sized panel of a fresh app
// run is already right — otherwise it guesses a fallback and then visibly
// corrects itself the moment the real keyboard arrives. Best-effort and
// racy by nature (the panel may open before this resolves); a real
// observation always wins over the restored value.
void loadString(STORAGE_KEY).then((raw) => {
  if (observedThisRun || raw == null) return;
  const px = Number(raw);
  if (Number.isFinite(px) && px > 0 && px < 2000) observedLift = px;
});

/**
 * @internal Record an observed lift. Keeps the LATEST, never a running max.
 *
 * A device's keyboard is not one height: the suggestion strip comes and
 * goes, numeric and alpha layouts differ, IMEs differ. A panel sized to
 * occupy the keyboard's space has to match the keyboard that is about to
 * appear — the best predictor of which is the one that appeared last, not
 * the tallest ever seen. Taking a max made one tall observation stick
 * permanently and opened the panel 36 px too tall forever after (#811).
 *
 * Safe because this is fed from the BG-reactive inset, which STEPS to its
 * final value — the animation lives in the lift SharedValue, so there are
 * no intermediate heights to latch onto here.
 */
function recordLift(px: number): void {
  observedThisRun = true;
  observedLift = px;
  // Persist only when the stored value would actually change. This runs
  // from a computed that any number of mounted hooks re-evaluate, so an
  // unguarded write turned every keyboard show/hide into a burst of
  // identical `Storage.setItem` calls.
  const next = String(Math.round(px));
  if (next !== persisted) {
    persisted = next;
    saveString(STORAGE_KEY, next);
  }
}

/**
 * The most recently observed keyboard lift (px), or 0 if the keyboard has
 * never been shown. Seed a keyboard-sized panel from this instead of a flat
 * fallback — see {@link useKeyboardLift}.
 */
export function rememberedKeyboardLift(): number {
  return observedLift;
}

/** @internal Test seam — forget the session's observation. */
export function resetRememberedKeyboardLift(): void {
  observedLift = 0;
  observedThisRun = false;
  persisted = null;
}

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
    const lift = Math.max(0, i.keyboard - (discountBottomInset ? i.bottom : 0) + offset);
    if (discountBottomInset && offset === 0) recordLift(lift);
    return lift;
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

  const computeLift = (i: { keyboard: number; bottom: number }): number => {
    if (i.keyboard <= 0) return 0;
    const lift = Math.max(0, i.keyboard - (discountBottomInset ? i.bottom : 0) + offset);
    if (discountBottomInset && offset === 0) recordLift(lift);
    return lift;
  };

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
