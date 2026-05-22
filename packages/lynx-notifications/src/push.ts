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
    return subscribe<NotificationResponse>(RESPONSE_CHANNEL, cb);
}
