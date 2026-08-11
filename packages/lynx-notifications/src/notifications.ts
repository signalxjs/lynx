import { callAsync, isModuleAvailable, unwrapNative, unwrapNativeVoid } from '@sigx/lynx-core';
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
/** Package short name for `unwrapNative`'s C10 message prefix. */
const PKG = 'lynx-notifications';

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
    /**
     * Post a local notification and resolve its id.
     *
     * **Throws** if the OS refuses it (C4) — `UNUserNotificationCenter.add`
     * reports one on iOS, an exception in the builder on Android. Both used to
     * arrive as an `{ error }` object typed `string`, so the caller believed a
     * notification had been posted and held an id that cancels nothing.
     */
    async schedule(content: NotificationContent, options: ScheduleOptions = {}): Promise<string> {
        return unwrapNative(
            PKG,
            'schedule',
            await callAsync<string>(MODULE, 'schedule', content, options),
        );
    },

    /**
     * Cancel a pending scheduled notification and dismiss any delivered tray
     * entry — local (id returned by `schedule`) or **remote push** — matching
     * the id. Remote pushes match when they were sent with
     * `data.notification_id === notificationId` (both platforms), e.g. to
     * clear a conversation's notification when it's read on another device.
     *
     * Resolves `false` when the native side could not process the call
     * (missing id / platform error); note `true` does not imply a matching
     * tray entry existed.
     *
     * **C3/C4 opt-out — a failure comes back as `false`, not a throw.**
     * Dismissal is advisory and idempotent: it's fired from cleanup paths
     * ("the conversation was read elsewhere") where a throw would abort
     * unrelated work, and since `true` never proved an entry existed, `false`
     * carries no more actionable detail than "nothing was dismissed". Neither
     * native ever sends an `{ error }` envelope here — both catch and answer
     * `false` — so there is nothing for `unwrapNative` to unwrap. Documented
     * in the README's Gotchas.
     */
    cancel(notificationId: string): Promise<boolean> {
        return callAsync<boolean>(MODULE, 'cancel', notificationId);
    },

    /**
     * Cancel all pending notifications and clear every delivered tray entry.
     *
     * Same C3/C4 opt-out as `cancel` — a failure resolves `false` rather than
     * throwing; see there and the README's Gotchas.
     */
    cancelAll(): Promise<boolean> {
        return callAsync<boolean>(MODULE, 'cancelAll');
    },

    /**
     * Request notification permission, showing the OS dialog if needed.
     *
     * Not unwrapped: iOS folds an authorization *error* into the envelope as
     * `{ status: 'denied', error }`, so a status is always returned. Whether
     * that should stay a status or become a throw is the repo-wide C6
     * denied-vs-blocked mapping question tracked on #895 — settling it here
     * alone would make notifications the one module whose permission call can
     * reject.
     */
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
     *
     * **C3/C4 opt-out — a registration failure resolves with `{ error }`
     * rather than throwing.** Registration is event-channel-owned: iOS can
     * only ever report a failure asynchronously through
     * `addTokenErrorListener`, and Android publishes to that same channel
     * *before* it answers this promise. So the failure already reaches the one
     * handler both platforms share, and the `error` field is a mirror of it,
     * not the sole signal — throwing here would force every caller to handle
     * the same failure twice. Documented in the README's Gotchas.
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
     *
     * **C3/C4 opt-out — same reasoning as `registerForPushNotifications`:**
     * the failure is published on the shared token-error channel first, and
     * `ok: false` is the flag callers branch on. Documented in the README's
     * Gotchas.
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
     *
     * **Throws** when iOS 16+'s `setBadgeCount` reports an error (C4) — a
     * `Promise<void>` discarded that envelope entirely, so a badge that never
     * changed looked exactly like one that did.
     */
    async setBadgeCount(count: number): Promise<void> {
        unwrapNativeVoid(
            PKG,
            'setBadgeCount',
            await callAsync<{ error?: string } | boolean>(MODULE, 'setBadgeCount', count),
        );
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
