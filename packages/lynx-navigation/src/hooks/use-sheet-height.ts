import { useDerivedValueReactive, useSharedValue, type SharedValue } from '@sigx/lynx';

import { useNav } from './use-nav.js';
import { useNavInternals } from './use-nav-internal.js';
import { resolveSnapPoints } from '../internal/sheet-math.js';
import { SCREEN_HEIGHT } from '../internal/screen-width.js';

/**
 * The live visible HEIGHT (px) of the top bottom sheet — `0` when no sheet is
 * open, rising to its detent height as the sheet opens/drags, tracking the
 * finger frame-for-frame (the sheet SV auto-flushes since #681).
 *
 * Bind it like any `SharedValue`. The canonical use is a chat composer bar
 * that must sit above **whichever is taller** — the soft keyboard or the emoji
 * sheet — via `useDerivedValue([keyboardLift, useSheetHeight()], 'max')`:
 *
 * ```tsx
 * const sheetH = useSheetHeight();
 * const lift = useDerivedValue([keyboardLift, sheetH], 'max');
 * useAnimatedStyle(barRef, lift, 'translateY', { factor: -1 });
 * ```
 *
 * Height is `sheetProgress × maxFraction × SCREEN_HEIGHT` — the navigator's
 * dedicated `sheetProgress` SV (open fraction, 0..1) scaled by the ACTIVE
 * sheet's largest snap fraction. The scale factor rebinds reactively when the
 * active sheet (and thus its snap points) changes, so the derived SV identity
 * stays stable for consumers.
 *
 * Returns a constant-`0` SV when the navigator was created with
 * `animated={false}` (there is no sheet SV to track).
 *
 * Must be called under a `<NavigationRoot>`.
 */
export function useSheetHeight(): SharedValue<number> {
  const internals = useNavInternals();
  const nav = useNav();
  const progress = internals.sheetProgress;

  // Animations disabled — no sheet SV exists. A constant-0 SV keeps the
  // caller's binding code uniform (it never moves).
  if (!progress) return useSharedValue(0);

  return useDerivedValueReactive(() => {
    // The active sheet: a transitioning sheet top, else a resting top sheet
    // (mirrors <Stack>'s activeSheetEntry). Reactive reads — a late
    // `<Screen snapPoints>` registration re-runs this and corrects the
    // factor.
    const transitionTop = nav.transition?.topEntry;
    const currentTop = nav.current;
    const active =
      transitionTop?.presentation === 'sheet'
        ? transitionTop
        : currentTop?.presentation === 'sheet'
          ? currentTop
          : null;

    // maxFraction × SCREEN_HEIGHT is the sheet's full travel in px; ×progress
    // gives the live visible height. No active sheet → progress rests at 0,
    // so any factor yields 0; use 1 as a harmless default.
    const maxFraction = active
      ? (() => {
          const snaps = resolveSnapPoints(
            internals.screens.get(active.key)?.options?.snapPoints,
          );
          return snaps[snaps.length - 1]!;
        })()
      : 1;

    return {
      sources: [progress],
      reducer: 'scale' as const,
      params: { factor: maxFraction * SCREEN_HEIGHT },
    };
  });
}
