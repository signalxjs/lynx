import { useSharedValue, type SharedValue } from '@sigx/lynx';

import { useNavInternals } from './use-nav-internal.js';

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
 * Since the reveal-px conversion (#774) the navigator's dedicated sheet SV
 * carries these semantics directly — reveal px IS the visible height — so
 * this returns that SV as-is: no progress→px scaling, no per-sheet factor
 * rebind, and the identity is trivially stable for consumers.
 *
 * Returns a constant-`0` SV when the navigator was created with
 * `animated={false}` (there is no sheet SV to track).
 *
 * Must be called under a `<NavigationRoot>`.
 */
export function useSheetHeight(): SharedValue<number> {
  const internals = useNavInternals();
  const reveal = internals.sheetReveal;

  // Animations disabled — no sheet SV exists. A constant-0 SV keeps the
  // caller's binding code uniform (it never moves).
  if (!reveal) return useSharedValue(0);

  return reveal;
}
