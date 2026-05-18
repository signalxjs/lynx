/**
 * @deprecated since Phase 2.8 — renamed to `SharedValue` to reflect that the
 * primitive is a general MT-writeable, BG-observable cross-thread value, not
 * an animation-specific construct. Animation is one customer; scroll, sensors,
 * and gestures are equally first-class consumers.
 *
 * Import from `@sigx/lynx` directly:
 *
 *   - `useAnimatedValue` → `useSharedValue`
 *   - `AnimatedValue`     → `SharedValue`
 *   - `AnimatedValueState` → `SharedValueState`
 *
 * The old names continue to work via these re-exports for one minor cycle.
 */

export {
  SharedValue as AnimatedValue,
  useSharedValue as useAnimatedValue,
} from './shared-value';
export type { SharedValueState as AnimatedValueState } from './shared-value';
