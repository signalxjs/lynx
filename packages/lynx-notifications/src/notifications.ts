import { callAsync, isModuleAvailable } from '@sigx/lynx-core';
import type { PermissionResponse } from '@sigx/lynx-core';
import {
    addTokenListener,
    addTokenErrorListener,
    addPushListener,
    addNotificationResponseListener,
    parseNotificationResponse,
    type NotificationResponse,
    type PushTokenEvent,
    type PushTokenError,
    type RemoteMessage,
} from './push.js';

const MODULE = 'Notifications';

export interface NotificationContent {
    title: string;
    body: string;
    /** Optional data payload. Round-tripped to JS on tap responses. */
    data?: Record<string, string>;
}

export interface ScheduleOptions {
    /** Delay in seconds from now */
    delay?: number;
    /** Repeat interval: 'minute', 'hour', 'day', 'week' */
    repeat?: 'minute' | 'hour' | 'day' | 'week';
}

export interface RegisterPushResult {
    token?: string;
    platform?: 'apns' | 'fcm';
    /** iOS resolves with `{ dispatched: true }` — the real token arrives via `addTokenListener`. */
    dispatched?: boolean;
    error?: string;
}

export interface UnregisterPushResult {
    ok: boolean;
    error?: string;
}

/**
 * Local + remote notification APIs.
 *
 * @example
 * ```ts
 * import { Notifications } from '@sigx/lynx-notifications';
 *
 * const { status } = await Notifications.requestPermission();
 * if (status !== 'granted') return;
 *
 * // Remote push registration. On iOS the real token arrives via addTokenListener;
 * // on Android the token is in the promise result.
 * Notifications.addTokenListener(({ token, platform }) => {
 *     // POST token + platform to your backend (Azure Notification Hubs / Firebase Admin / …)
 * });
 * Notifications.addPushListener((msg) => {
 *     console.log('push received', msg);
 * });
 * Notifications.addNotificationResponseListener((resp) => {
 *     // user tapped the notification — route them somewhere
 * });
 *
 * await Notifications.registerForPushNotifications();
 *
 * // Cold-start tap (if any)
 * const initial = await Notifications.getInitialNotification();
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

    /**
     * Trigger remote-push registration.
     *
     * iOS: dispatches `application.registerForRemoteNotifications()`. The
     * token (or error) arrives asynchronously via `addTokenListener` /
     * `addTokenErrorListener`. The promise resolves with `{ dispatched: true }`
     * once the call has been made.
     *
     * Android: resolves directly with the FCM token. Also publishes the token
     * via the listener channel so JS code that wires both paths sees one
     * canonical event.
     */
    registerForPushNotifications(): Promise<RegisterPushResult> {
        return callAsync<RegisterPushResult>(MODULE, 'registerForPushNotifications');
    },

    /**
     * Detach from APNs / FCM.
     *
     * iOS: synchronous — resolves with `{ ok: true }` after
     * `unregisterForRemoteNotifications` is called.
     * Android: awaits the FCM `deleteToken()` Task; resolves with
     * `{ ok: false, error }` if the network call fails so the JS caller
     * doesn't believe it's unregistered while the server keeps pushing.
     * Failures also publish on the `addTokenErrorListener` channel.
     */
    unregisterForPushNotifications(): Promise<UnregisterPushResult> {
        return callAsync<UnregisterPushResult>(MODULE, 'unregisterForPushNotifications');
    },

    /**
     * iOS: app-icon badge count. iOS 16+ uses
     * `UNUserNotificationCenter.setBadgeCount`; older falls back to
     * `applicationIconBadgeNumber`.
     *
     * Android: no-op. Stock Android has no portable badging API (it's
     * vendor-specific — Samsung's `ShortcutBadger`, etc.) and this call
     * does NOT clear pending notifications — callers wanting that should
     * use `cancelAll()` directly.
     */
    setBadgeCount(count: number): Promise<void> {
        return callAsync<void>(MODULE, 'setBadgeCount', count);
    },

    /** iOS: current badge number. Android: always 0 (no portable read API). */
    getBadgeCount(): Promise<number> {
        return callAsync<number>(MODULE, 'getBadgeCount');
    },

    /**
     * If the app was launched by a notification tap, returns the payload.
     * One-shot: subsequent calls return null. Call exactly once during startup.
     *
     * Native returns a JSON string (or null) — the payload nests `data`, and a
     * structured map loses its sibling scalars crossing the bridge (#342). See
     * `parseNotificationResponse`.
     */
    async getInitialNotification(): Promise<NotificationResponse | null> {
        return parseNotificationResponse(
            await callAsync<unknown>(MODULE, 'getInitialNotification'),
        );
    },

    // ── Event subscriptions ─────────────────────────────────────────────────
    // Re-exported so consumers can chain `Notifications.addTokenListener(...)`
    // without a second import. Each returns an unsubscribe function.

    addTokenListener,
    addTokenErrorListener,
    addPushListener,
    addNotificationResponseListener,

    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;

export type { NotificationResponse, PushTokenEvent, PushTokenError, RemoteMessage };
// `UnregisterPushResult` is declared above; re-export via index.ts.
