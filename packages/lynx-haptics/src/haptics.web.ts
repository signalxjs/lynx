/**
 * Web implementation: best-effort vibration through the `@sigx/lynx-web-host`
 * page bridge (`sigx.haptics.vibrate` → `navigator.vibrate`, Chromium-only).
 * The Haptics contract is **never throw** — callers fire haptics as the first
 * line of event handlers — so every path here swallows failures silently.
 * `isAvailable()` stays `false`: web vibration is a degraded approximation,
 * and callers branching on availability should treat web as "no haptics"
 * (matching the previous no-op behavior).
 * Swapped in by the plugin's `.web.js` extensionAlias (#697).
 */
import { webHostCall, isWebHostAvailable } from '@sigx/lynx-core';

import type { HapticsDiagnostics, ImpactStyle, NotificationType } from './haptics.js';

export type { HapticsDiagnostics, ImpactStyle, NotificationType } from './haptics.js';

const IMPACT_MS: Record<ImpactStyle, number> = { light: 8, medium: 15, heavy: 25 };
const NOTIFICATION_PATTERNS: Record<NotificationType, number[]> = {
  success: [10, 40, 10],
  warning: [20, 60, 20],
  error: [30, 60, 30, 60, 30],
};

function vibrate(pattern: number | number[]): void {
  if (!isWebHostAvailable()) return;
  webHostCall<void>('haptics.vibrate', { pattern }).catch(() => {
    /* never throw, never log — fire-and-forget by contract */
  });
}

export const Haptics: typeof import('./haptics.js').Haptics = {
  impact(style: ImpactStyle = 'medium'): void {
    vibrate(IMPACT_MS[style] ?? IMPACT_MS.medium);
  },

  notification(type: NotificationType = 'success'): void {
    vibrate(NOTIFICATION_PATTERNS[type] ?? NOTIFICATION_PATTERNS.success);
  },

  selection(): void {
    vibrate(5);
  },

  isAvailable(): boolean {
    return false; // degraded approximation — see module docblock
  },

  diagnose(): Promise<HapticsDiagnostics> {
    return Promise.resolve({ hasVibrator: false });
  },
} as const;
