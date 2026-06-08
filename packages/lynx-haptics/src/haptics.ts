import { callAsync, callSync, isModuleAvailable } from '@sigx/lynx-core';

const MODULE = 'Haptics';

/**
 * Vibrator state — useful for diagnosing why an `impact()` call doesn't
 * produce a perceptible buzz (Android only; iOS always returns the same
 * `hasVibrator: true`).
 */
export interface HapticsDiagnostics {
    hasVibrator: boolean;
    sdk?: number;
    hasVibratePermission?: boolean;
    hasAmplitudeControl?: boolean;
}

export type ImpactStyle = 'light' | 'medium' | 'heavy';
export type NotificationType = 'success' | 'warning' | 'error';

/**
 * Haptic feedback APIs.
 *
 * The three feedback methods (`impact` / `notification` / `selection`) are
 * best-effort and **no-op silently when the host has no Haptics module** —
 * notably on web (`@lynx-js/web-core`), but also any device build that didn't
 * bundle it. They must never throw: callers routinely fire haptics as the first
 * line of an event handler (e.g. `Haptics.selection(); nav.push(...)`), so a
 * throw here would abort the rest of the handler (swallowing the navigation).
 * Use `isAvailable()` if you need to branch on support.
 *
 * @example
 * ```ts
 * import { Haptics } from '@sigx/lynx-haptics';
 *
 * Haptics.impact('medium');
 * Haptics.notification('success');
 * Haptics.selection();
 * ```
 */
export const Haptics = {
    impact(style: ImpactStyle = 'medium'): void {
        if (!isModuleAvailable(MODULE)) return;
        callSync(MODULE, 'impact', style);
    },

    notification(type: NotificationType = 'success'): void {
        if (!isModuleAvailable(MODULE)) return;
        callSync(MODULE, 'notification', type);
    },

    selection(): void {
        if (!isModuleAvailable(MODULE)) return;
        callSync(MODULE, 'selection');
    },

    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },

    /**
     * Surface vibrator + permission state. Android-only; iOS returns
     * `{ hasVibrator: true }` as a placeholder. Use this to diagnose
     * why `impact()` doesn't produce a perceptible buzz on a device.
     */
    diagnose(): Promise<HapticsDiagnostics> {
        return callAsync<HapticsDiagnostics>(MODULE, 'diagnose');
    },
} as const;
