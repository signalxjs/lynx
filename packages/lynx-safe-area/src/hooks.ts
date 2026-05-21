import { computed, type Computed, type PrimitiveSignal } from '@sigx/reactivity';
import { useSafeAreaContext } from './injectable.js';
import { readGlobalSafeArea } from './globals.js';
import { ZERO_INSETS, type EdgeInsets, type SafeAreaContextValue } from './types.js';

type InsetsRead = PrimitiveSignal<EdgeInsets> | Computed<EdgeInsets>;

/**
 * BG-side reactive read of current safe-area insets. Returns the live signal
 * — components calling this re-render on inset change (rotation, keyboard,
 * split-view).
 *
 * If no `<SafeAreaProvider>` is in scope, returns a signal seeded with
 * `ZERO_INSETS` and warns in dev. (We don't throw because mounting an app
 * fragment for tests/storybook without a provider is convenient and the
 * zero fallback degrades gracefully.)
 *
 * @example
 * ```tsx
 * const insets = useSafeAreaInsets();
 * return () => <view style={{ paddingTop: insets.value.top }} />;
 * ```
 */
export function useSafeAreaInsets(): InsetsRead {
  const ctx = useSafeAreaContext();
  if (!ctx) return fallbackSignal();
  return ctx.insets;
}

/**
 * Per-edge SharedValues for MT-driven `useAnimatedStyle` bindings — the
 * recommended path for `<SafeAreaView>`-style layouts that need padding to
 * track insets without a BG re-render. See `safe-area-view.tsx` for the
 * canonical consumer.
 */
export function useSafeAreaSharedValues(): SafeAreaContextValue['sv'] | null {
  const ctx = useSafeAreaContext();
  return ctx?.sv ?? null;
}

/**
 * Computed signal of the inner safe frame (origin + size) in dp/pt.
 *
 * Useful for absolute-positioned overlays, modal bounds, and layout math
 * that needs to know "the visible content rect" rather than just the inset
 * deltas. The frame size is computed from the host viewport — you must pass
 * `viewportWidth`/`viewportHeight` (typically read once via
 * `@sigx/lynx-device-info`) since the safe-area module deliberately avoids
 * pulling that whole dependency.
 *
 * @example
 * ```tsx
 * const { screenWidth, screenHeight } = await DeviceInfo.getInfo();
 * const frame = useSafeAreaFrame(screenWidth, screenHeight);
 * return () => <view style={{
 *   position: 'absolute',
 *   top: frame.value.y, left: frame.value.x,
 *   width: frame.value.width, height: frame.value.height,
 * }} />;
 * ```
 */
export function useSafeAreaFrame(
  viewportWidth: number,
  viewportHeight: number,
): Computed<{ x: number; y: number; width: number; height: number }> {
  const insets = useSafeAreaInsets();
  return computed(() => {
    const i = insets.value;
    return {
      x: i.left,
      y: i.top,
      width: Math.max(0, viewportWidth - i.left - i.right),
      height: Math.max(0, viewportHeight - i.top - i.bottom - i.keyboard),
    };
  });
}

/**
 * **MT-thread** synchronous read of the current safe-area insets. For use
 * inside `'main thread'`-marked worklet bodies. Reads `lynx.__globalProps`
 * directly — there's no signal subscription, so callers re-evaluate per
 * worklet invocation rather than reactively.
 *
 * For declarative MT-driven layout (the common case), prefer
 * `<SafeAreaView edges={…}>`, which composes `useSafeAreaSharedValues()`
 * with `useAnimatedStyle` — that path is reactive and applies on flush.
 */
export function useSafeAreaInsetsMT(): EdgeInsets {
  return readGlobalSafeArea();
}

let _fallback: Computed<EdgeInsets> | undefined;
function fallbackSignal(): Computed<EdgeInsets> {
  if (!_fallback) {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env?.['NODE_ENV'];
    if (env !== 'production') {
      console.warn(
        '[sigx-safe-area] useSafeAreaInsets() called outside <SafeAreaProvider>. ' +
        'Returning ZERO_INSETS. Wrap your app in <SafeAreaProvider> to receive ' +
        'live device insets.',
      );
    }
    _fallback = computed(() => ZERO_INSETS);
  }
  return _fallback;
}
