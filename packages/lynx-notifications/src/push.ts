/**
 * Remote-push event subscriptions. Backed by `GlobalEventEmitter` on four
 * native channels: `__sigxPushToken`, `__sigxPushTokenError`,
 * `__sigxPushMessage`, `__sigxNotificationResponse`. The native side carries
 * the same channel names — JS shims here just adapt the listener-bag API.
 */

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
    /** 'default' for the standard tap; custom action ids when categories ship. */
    actionIdentifier: string;
}

interface GlobalEventEmitterLike {
    addListener: (name: string, fn: (...a: unknown[]) => void) => void;
    removeListener: (name: string, fn: (...a: unknown[]) => void) => void;
}

interface LynxLike {
    getJSModule?: (name: string) => GlobalEventEmitterLike | undefined;
}

declare const lynx: unknown | undefined;

function emitter(): GlobalEventEmitterLike | undefined {
    if (typeof lynx === 'undefined') return undefined;
    const obj = lynx as unknown as LynxLike;
    return obj.getJSModule?.('GlobalEventEmitter');
}

function subscribe<T>(
    channel: string,
    cb: (event: T) => void,
): () => void {
    const e = emitter();
    if (!e) {
        // Web / SSR / test fallback: no native bridge, just return a no-op
        // unsubscribe. The shim is a one-way data path — there's nothing
        // useful to emulate.
        return () => {};
    }
    const wrapped = (raw: unknown) => {
        const event = (typeof raw === 'string' ? safeParse(raw) : raw) as T | undefined;
        if (event === undefined) return;
        try {
            cb(event);
        } catch (err) {
            console.warn(`[notifications] listener for ${channel} threw:`, err);
        }
    };
    e.addListener(channel, wrapped);
    return () => e.removeListener(channel, wrapped);
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
    if (v === null || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (typeof o['notificationId'] !== 'string') return null;
    const data = o['data'];
    return {
        notificationId: o['notificationId'],
        data: (data !== null && typeof data === 'object' ? data : {}) as Record<string, string>,
        actionIdentifier:
            typeof o['actionIdentifier'] === 'string' ? o['actionIdentifier'] : 'default',
    };
}

export function addTokenListener(cb: (event: PushTokenEvent) => void): () => void {
    return subscribe<PushTokenEvent>(TOKEN_CHANNEL, cb);
}

export function addTokenErrorListener(cb: (event: PushTokenError) => void): () => void {
    return subscribe<PushTokenError>(TOKEN_ERROR_CHANNEL, cb);
}

export function addPushListener(cb: (event: RemoteMessage) => void): () => void {
    return subscribe<RemoteMessage>(MESSAGE_CHANNEL, cb);
}

export function addNotificationResponseListener(cb: (event: NotificationResponse) => void): () => void {
    // Normalize rather than pass the raw event through: `notificationId` and
    // `actionIdentifier` are the fields consumers route on, and a payload that
    // lost them shouldn't reach a listener as a partial (#342 / #619).
    return subscribe<unknown>(RESPONSE_CHANNEL, (raw) => {
        const event = parseNotificationResponse(raw);
        if (event) cb(event);
    });
}
