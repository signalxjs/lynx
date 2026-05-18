/**
 * Convenience wrapper: animate(sv, target, { type: 'tween', ...opts }).
 * Returns the completion promise rather than the full controls handle —
 * use `animate()` directly if you need cancellation.
 *
 * Duration is in seconds (default 0.3). Ease defaults to `easeOut`.
 */

import type { SharedValue } from '@sigx/lynx';

import { animate, type TimingOptions } from './animate';

export function withTiming(
  sv: SharedValue<number>,
  target: number,
  options: TimingOptions = {},
): Promise<void> {
  'main thread';
  return animate(sv, target, { ...options, type: 'tween' }).finished;
}
