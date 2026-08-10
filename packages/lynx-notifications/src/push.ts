/**
 * Remote-push event subscriptions. Backed by `GlobalEventEmitter` on four
 * native channels: `__sigxPushToken`, `__sigxPushTokenError`,
 * `__sigxPushMessage`, `__sigxNotificationResponse`. The native side carries
 * the same channel names — JS shims here just adapt the listener-bag API.
 *
 * The subscription itself is core's `subscribeNative` (CONVENTIONS.md C7).
 * This file used to carry its own copy of that shim — one of sixteen in the
 * repo — each re-deriving the emitter lookup, the string-or-object payload
 * parse, the listener-throws guard and the off-device fallback. Adopting it
 * also makes every disposer here **idempotent**: the old one called
 * `removeListener` again on each extra call, which an effect cleanup firing
 * twice does routinely.
 */
import { subscribeNative } from '@sigx/lynx-core';

/** Logger namespace for the "listener threw" diagnostic (C10). */
const NAMESPACE = 'lynx-notifications';

const TOKEN_CHANNEL = '__sigxPushToken';
const TOKEN_ERROR_CHANNEL = '__sigxPushTokenError';
const MESSAGE_CHANNEL = '__sigxPushMessage';
const RESPONSE_CHANNEL = '__sigxNotificationResponse';

export interface PushTokenEvent {
    token: string;
    platform: 'apns' | 'fcm';
}

export interface PushTokenError {
    error: string;
}

export interface RemoteMessage {
    title?: string;
    body?: string;
    data: Record<string, string>;
    foreground: boolean;
}

export interface NotificationResponse {
    notificationId: string;
    data: Record<string, string>;
    /**
     * `'default'` for the standard tap — today the only value either platform
     * emits.
     *
     * Normalized across platforms: iOS reports Apple's
     * `UNNotificationDefaultActionIdentifier` for a plain tap, which the native
     * side maps onto `'default'` so `actionIdentifier === 'default'` means the
     * same thing on both.
     *
     * Custom action ids will arrive verbatim once notification categories ship.
     * The native side also maps Apple's dismiss constant onto `'dismiss'`, but
     * nothing emits it yet: iOS only delivers that action for a category
     * registered with `.customDismissAction` (none are), and Android sets no
     * `deleteIntent`. Don't branch on it expecting dismissals.
     */
    actionIdentifier: string;
}

/**
 * Plain-object check shared by the payload guards below.
 *
 * Arrays are objects in JS — reject them, or a `['a','b']` payload would read
 * as an object with numeric keys.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Guards for the three pass-through channels. Each asserts exactly the
 * *required* fields of its interface, so a listener typed `(e: T) => void` can
 * trust its argument — a payload that lost `token` or `data` crossing the
 * bridge (#342) is dropped rather than delivered as a partial `T`. Optional
 * `title` / `body` are not checked: a data-only FCM message legitimately has
 * neither.
 */
function isPushTokenEvent(raw: unknown): raw is PushTokenEvent {
    return (
        isRecord(raw) &&
        typeof raw['token'] === 'string' &&
        (raw['platform'] === 'apns' || raw['platform'] === 'fcm')
    );
}

function isPushTokenError(raw: unknown): raw is PushTokenError {
    return isRecord(raw) && typeof raw['error'] === 'string';
}

function isRemoteMessage(raw: unknown): raw is RemoteMessage {
    return isRecord(raw) && isRecord(raw['data']) && typeof raw['foreground'] === 'boolean';
}

function safeParse(s: string): unknown {
    try { return JSON.parse(s); } catch { return undefined; }
}

/**
 * Normalize a raw native notification-response payload.
 *
 * Accepts the JSON-string form the native side emits — both the response
 * channel and `getInitialNotification`'s callback JSON-encode, because a
 * structured map loses its sibling scalars crossing the bridge (#342) — as
 * well as a plain object, so a host that marshals maps faithfully still works.
 *
 * Returns null for anything unusable: a missing `notificationId` means the
 * payload didn't survive, and a caller routing on it should treat that as "no
 * tap" rather than deep-link into a partial.
 */
export function parseNotificationResponse(raw: unknown): NotificationResponse | null {
    const v = typeof raw === 'string' ? safeParse(raw) : raw;
    // Arrays are objects in JS; reject them here so the "plain object" contract
    // is enforced rather than implied. Belt-and-braces — an array can't carry a
    // string `notificationId` through JSON anyway, so it would fall out below.
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    if (typeof o['notificationId'] !== 'string') return null;
    return {
        notificationId: o['notificationId'],
        data: stringRecord(o['data']),
        actionIdentifier:
            typeof o['actionIdentifier'] === 'string' ? o['actionIdentifier'] : 'default',
    };
}

/**
 * Coerce a raw `data` value to the documented `Record<string, string>`.
 *
 * Both platforms only ever send string values (FCM's `data` map is string-only,
 * and iOS JSON-encodes anything else), so a non-string value means the payload
 * isn't what it claims. Drop those keys rather than hand a consumer a value
 * whose type contradicts the signature. Arrays are objects in JS — reject them
 * too, or `data` would come back with numeric keys.
 */
function stringRecord(raw: unknown): Record<string, string> {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v;
    }
    return out;
}

/** Subscribe to push-token events. Returns an idempotent unsubscribe (C7). */
export function addTokenListener(cb: (event: PushTokenEvent) => void): () => void {
    return subscribeNative<PushTokenEvent>(TOKEN_CHANNEL, cb, {
        validate: isPushTokenEvent,
        namespace: NAMESPACE,
    });
}

/** Subscribe to push-registration failures. Returns an idempotent unsubscribe (C7). */
export function addTokenErrorListener(cb: (event: PushTokenError) => void): () => void {
    return subscribeNative<PushTokenError>(TOKEN_ERROR_CHANNEL, cb, {
        validate: isPushTokenError,
        namespace: NAMESPACE,
    });
}

/** Subscribe to incoming remote messages. Returns an idempotent unsubscribe (C7). */
export function addPushListener(cb: (event: RemoteMessage) => void): () => void {
    return subscribeNative<RemoteMessage>(MESSAGE_CHANNEL, cb, {
        validate: isRemoteMessage,
        namespace: NAMESPACE,
    });
}

/** Subscribe to notification taps. Returns an idempotent unsubscribe (C7). */
export function addNotificationResponseListener(cb: (event: NotificationResponse) => void): () => void {
    // Normalize rather than pass the raw event through: `notificationId` and
    // `actionIdentifier` are the fields consumers route on, and a payload that
    // lost them shouldn't reach a listener as a partial (#342 / #619).
    //
    // This one *normalizes* (defaults `actionIdentifier`, filters non-string
    // `data` values), which a `validate` type guard can't do — it may only
    // accept or reject. So the check stays in the callback and
    // `parseNotificationResponse` doubles as the guard: `null` means drop.
    return subscribeNative<unknown>(
        RESPONSE_CHANNEL,
        (raw) => {
            const event = parseNotificationResponse(raw);
            if (event) cb(event);
        },
        { namespace: NAMESPACE },
    );
}
