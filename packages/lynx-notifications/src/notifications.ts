import { callAsync, isModuleAvailable } from '@sigx/lynx-core';
import type { PermissionResponse } from '@sigx/lynx-core';

const MODULE = 'Notifications';

export interface NotificationContent {
    title: string;
    body: string;
    /** Optional data payload */
    data?: Record<string, string>;
}

export interface ScheduleOptions {
    /** Delay in seconds from now */
    delay?: number;
    /** Repeat interval: 'minute', 'hour', 'day', 'week' */
    repeat?: 'minute' | 'hour' | 'day' | 'week';
}

/**
 * Local notification APIs.
 *
 * @example
 * ```ts
 * import { Notifications } from '@sigx/lynx-notifications';
 *
 * const { status } = await Notifications.requestPermission();
 * if (status === 'granted') {
 *     await Notifications.schedule({ title: 'Reminder', body: 'Check your tasks' }, { delay: 60 });
 * }
 * ```
 */
export const Notifications = {
    schedule(content: NotificationContent, options: ScheduleOptions = {}): Promise<string> {
        return callAsync<string>(MODULE, 'schedule', content, options);
    },

    cancel(notificationId: string): Promise<void> {
        return callAsync<void>(MODULE, 'cancel', notificationId);
    },

    cancelAll(): Promise<void> {
        return callAsync<void>(MODULE, 'cancelAll');
    },

    /** Request notification permission, showing the OS dialog if needed. */
    requestPermission(): Promise<PermissionResponse> {
        return callAsync<PermissionResponse>(MODULE, 'requestPermission');
    },

    /** Check current notification permission status without prompting. */
    getPermissionStatus(): Promise<PermissionResponse> {
        return callAsync<PermissionResponse>(MODULE, 'getPermissionStatus');
    },

    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
