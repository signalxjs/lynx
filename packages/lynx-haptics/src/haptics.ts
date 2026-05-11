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
        callSync(MODULE, 'impact', style);
    },

    notification(type: NotificationType = 'success'): void {
        callSync(MODULE, 'notification', type);
    },

    selection(): void {
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
