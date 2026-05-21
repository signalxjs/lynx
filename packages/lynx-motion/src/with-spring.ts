/**
 * Convenience wrapper: animate(sv, target, { type: 'spring', ...opts }).
 * Returns the completion promise rather than the full controls handle —
 * use `animate()` directly if you need cancellation.
 */

import type { SharedValue } from '@sigx/lynx';

import { animate, type SpringOptions } from './animate.js';

export function withSpring(
  sv: SharedValue<number>,
  target: number,
  options: SpringOptions = {},
): Promise<void> {
  'main thread';
  return animate(sv, target, { ...options, type: 'spring' }).finished;
}
