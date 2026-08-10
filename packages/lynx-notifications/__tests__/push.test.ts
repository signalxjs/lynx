/**
 * Unit tests for the push listener subscriptions. Stubs
 * `lynx.getJSModule('GlobalEventEmitter')` so we drive native event delivery
 * in-process through the real `subscribeNative` from `@sigx/lynx-core` — the
 * shim under test is core's now (C7), and mocking it away would test nothing.
 * Real APNs/FCM round-trip is exercised on-device.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (...a: unknown[]) => void;
const emitter = {
    listeners: new Map<string, Set<Listener>>(),
    /** Every `removeListener(channel, …)` call that reached the emitter. */
    removeCalls: [] as string[],
    addListener(name: string, fn: Listener) {
        if (!this.listeners.has(name)) this.listeners.set(name, new Set());
        this.listeners.get(name)!.add(fn);
    },
    removeListener(name: string, fn: Listener) {
        this.removeCalls.push(name);
        this.listeners.get(name)?.delete(fn);
    },
    count(name: string) {
        return this.listeners.get(name)?.size ?? 0;
    },
    fire(name: string, ...args: unknown[]) {
        for (const fn of this.listeners.get(name) ?? []) fn(...args);
    },
};

(globalThis as unknown as { lynx: unknown }).lynx = {
    getJSModule: (name: string) =>
        name === 'GlobalEventEmitter' ? emitter : undefined,
};

const {
    addTokenListener,
    addTokenErrorListener,
    addPushListener,
    addNotificationResponseListener,
} = await import('../src/push.js');

const TOKEN = '__sigxPushToken';
const TOKEN_ERR = '__sigxPushTokenError';
const MSG = '__sigxPushMessage';
const RESP = '__sigxNotificationResponse';

const lynxGlobal = globalThis as unknown as { lynx: unknown };
const NATIVE_LYNX = lynxGlobal.lynx;

beforeEach(() => {
    emitter.removeCalls.length = 0;
});

afterEach(() => {
    emitter.listeners.clear();
    lynxGlobal.lynx = NATIVE_LYNX;
});

/** Every public subscription, with a payload its channel actually carries. */
const SUBSCRIPTIONS: Array<{
    label: string;
    channel: string;
    add: (cb: (event: unknown) => void) => () => void;
    payload: Record<string, unknown>;
}> = [
    {
        label: 'addTokenListener',
        channel: TOKEN,
        add: addTokenListener,
        payload: { token: 'abc', platform: 'apns' },
    },
    {
        label: 'addTokenErrorListener',
        channel: TOKEN_ERR,
        add: addTokenErrorListener,
        payload: { error: 'no aps-environment' },
    },
    {
        label: 'addPushListener',
        channel: MSG,
        add: addPushListener,
        payload: { data: { x: '1' }, foreground: true },
    },
    {
        label: 'addNotificationResponseListener',
        channel: RESP,
        add: addNotificationResponseListener,
        payload: { notificationId: 'n-1', data: {}, actionIdentifier: 'default' },
    },
];

describe('disposers are idempotent (C7)', () => {
    it.each(SUBSCRIPTIONS)(
        '$label: a second call is a no-op and other listeners keep receiving',
        ({ channel, add, payload }) => {
            // An effect cleanup firing twice (unmount plus an explicit
            // teardown) is ordinary. The pre-migration disposer was a bare
            // `() => e.removeListener(channel, wrapped)`, so every extra call
            // hit the emitter again — the same shape as the metering
            // reference-count bug that switched native metering off under a
            // still-subscribed listener in @sigx/lynx-audio.
            const seen: unknown[] = [];
            const offA = add(() => {});
            add((e) => seen.push(e));
            expect(emitter.count(channel)).toBe(2);

            offA();
            offA();
            offA();

            // The property under test is what *this code* does, not what the
            // fake tolerates: exactly one removeListener reaches the emitter.
            expect(emitter.removeCalls).toEqual([channel]);
            expect(emitter.count(channel)).toBe(1);

            emitter.fire(channel, payload);
            expect(seen).toHaveLength(1);
        },
    );

    it('does not throw out of an effect cleanup on a host that rejects unknown removals', () => {
        // Nothing guarantees `removeListener` is harmless for a handler the
        // host no longer knows about; this models a host that says so. The old
        // disposer had no guard at all, so the second call threw straight into
        // the caller's cleanup — where it strands every teardown queued behind
        // it.
        const listeners = new Map<string, Set<Listener>>();
        const strict = {
            addListener(name: string, fn: Listener) {
                if (!listeners.has(name)) listeners.set(name, new Set());
                listeners.get(name)!.add(fn);
            },
            removeListener(name: string, fn: Listener) {
                if (!listeners.get(name)?.delete(fn)) {
                    throw new Error(`no such listener on ${name}`);
                }
            },
        };
        lynxGlobal.lynx = {
            getJSModule: (n: string) => (n === 'GlobalEventEmitter' ? strict : undefined),
        };

        const seen: unknown[] = [];
        const off = addTokenListener(() => {});
        addTokenListener((e) => seen.push(e));

        expect(() => {
            off();
            off();
        }).not.toThrow();

        for (const fn of listeners.get(TOKEN) ?? []) fn({ token: 'abc', platform: 'apns' });
        expect(seen).toEqual([{ token: 'abc', platform: 'apns' }]);
    });
});

describe('addTokenListener', () => {
    it('delivers token payloads in order', () => {
        const seen: unknown[] = [];
        addTokenListener((e) => seen.push(e));
        emitter.fire(TOKEN, { token: 'abc', platform: 'apns' });
        emitter.fire(TOKEN, { token: 'def', platform: 'fcm' });
        expect(seen).toEqual([
            { token: 'abc', platform: 'apns' },
            { token: 'def', platform: 'fcm' },
        ]);
    });

    it('unsubscribe stops further deliveries', () => {
        const seen: unknown[] = [];
        const unsub = addTokenListener((e) => seen.push(e));
        emitter.fire(TOKEN, { token: 'first', platform: 'apns' });
        unsub();
        emitter.fire(TOKEN, { token: 'second', platform: 'apns' });
        expect(seen).toEqual([{ token: 'first', platform: 'apns' }]);
    });

    it('parses string-encoded payloads', () => {
        // Some Lynx hosts deliver payloads as JSON strings — the shim tolerates
        // both shapes. Same code path applies to all four channels.
        const seen: unknown[] = [];
        addTokenListener((e) => seen.push(e));
        emitter.fire(TOKEN, JSON.stringify({ token: 'json', platform: 'fcm' }));
        expect(seen).toEqual([{ token: 'json', platform: 'fcm' }]);
    });

    it('drops undefined payloads silently', () => {
        const seen: unknown[] = [];
        addTokenListener((e) => seen.push(e));
        emitter.fire(TOKEN, undefined);
        expect(seen).toEqual([]);
    });

    it('drops a payload whose token did not survive the bridge', () => {
        // The #342 signature. A listener typed `(e: PushTokenEvent) => void`
        // would otherwise POST `undefined` to the app's backend as a device
        // token — worse than never firing.
        const seen: unknown[] = [];
        addTokenListener((e) => seen.push(e));
        emitter.fire(TOKEN, JSON.stringify({ platform: 'apns' }));
        emitter.fire(TOKEN, JSON.stringify({ token: 'abc' }));
        emitter.fire(TOKEN, JSON.stringify([{ token: 'abc', platform: 'apns' }]));
        expect(seen).toEqual([]);
    });

    it('swallows listener errors so one bad handler does not break others', () => {
        const seen: unknown[] = [];
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        addTokenListener(() => { throw new Error('boom'); });
        addTokenListener((e) => seen.push(e));
        emitter.fire(TOKEN, { token: 'survived', platform: 'apns' });
        expect(seen).toEqual([{ token: 'survived', platform: 'apns' }]);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('addTokenErrorListener', () => {
    it('routes registration failures on its own channel', () => {
        const tokens: unknown[] = [];
        const errors: unknown[] = [];
        addTokenListener((e) => tokens.push(e));
        addTokenErrorListener((e) => errors.push(e));
        emitter.fire(TOKEN_ERR, { error: 'no aps-environment' });
        expect(tokens).toEqual([]);
        expect(errors).toEqual([{ error: 'no aps-environment' }]);
    });

    it('drops a payload with no error string', () => {
        const seen: unknown[] = [];
        addTokenErrorListener((e) => seen.push(e));
        emitter.fire(TOKEN_ERR, JSON.stringify({ code: 3 }));
        emitter.fire(TOKEN_ERR, 'plain string, not JSON');
        expect(seen).toEqual([]);
    });
});

describe('addPushListener', () => {
    it('delivers RemoteMessage payloads', () => {
        const seen: unknown[] = [];
        addPushListener((e) => seen.push(e));
        emitter.fire(MSG, {
            title: 'Hi', body: 'You', data: { x: '1' }, foreground: true,
        });
        expect(seen).toEqual([
            { title: 'Hi', body: 'You', data: { x: '1' }, foreground: true },
        ]);
    });

    it('parses the JSON-string form native actually emits', () => {
        // Not merely a tolerated alternative: both platforms JSON-encode this
        // channel, because a structured map loses its sibling scalars crossing
        // the bridge (#342). `title`/`body`/`foreground` only survive as JSON.
        const seen: unknown[] = [];
        addPushListener((e) => seen.push(e));
        emitter.fire(MSG, JSON.stringify({
            title: 'Hi', body: 'You', data: { x: '1' }, foreground: false,
        }));
        expect(seen).toEqual([
            { title: 'Hi', body: 'You', data: { x: '1' }, foreground: false },
        ]);
    });

    it('delivers a data-only message with no title/body', () => {
        // Data-only is the shape FCM hands to onMessageReceived in the
        // background; title/body are absent unless the sender set data.title.
        const seen: unknown[] = [];
        addPushListener((e) => seen.push(e));
        emitter.fire(MSG, JSON.stringify({ data: { route: '/x' }, foreground: false }));
        expect(seen).toEqual([{ data: { route: '/x' }, foreground: false }]);
    });

    it('drops a message that lost its data map or foreground flag', () => {
        // Both fields are required on `RemoteMessage` and both platforms
        // always send them; a payload missing one is the #342 shape, and
        // `msg.foreground` reading `undefined` silently routes a foreground
        // push down the background path.
        const seen: unknown[] = [];
        addPushListener((e) => seen.push(e));
        emitter.fire(MSG, JSON.stringify({ title: 'Hi', foreground: true }));
        emitter.fire(MSG, JSON.stringify({ data: { x: '1' } }));
        expect(seen).toEqual([]);
    });

    it('stops delivering after unsubscribe', () => {
        const seen: unknown[] = [];
        const unsub = addPushListener((e) => seen.push(e));
        emitter.fire(MSG, JSON.stringify({ data: {}, foreground: true }));
        unsub();
        emitter.fire(MSG, JSON.stringify({ data: { second: '1' }, foreground: true }));
        expect(seen).toEqual([{ data: {}, foreground: true }]);
    });
});

describe('addNotificationResponseListener', () => {
    it('delivers tap responses (remote OR local)', () => {
        const seen: unknown[] = [];
        addNotificationResponseListener((e) => seen.push(e));
        emitter.fire(RESP, {
            notificationId: 'abc-123',
            data: { route: '/inbox' },
            actionIdentifier: 'default',
        });
        expect(seen).toEqual([
            {
                notificationId: 'abc-123',
                data: { route: '/inbox' },
                actionIdentifier: 'default',
            },
        ]);
    });

    it('parses the JSON-string form native actually emits', () => {
        const seen: unknown[] = [];
        addNotificationResponseListener((e) => seen.push(e));
        emitter.fire(RESP, JSON.stringify({
            notificationId: 'abc-123',
            data: { route: '/inbox' },
            actionIdentifier: 'default',
        }));
        expect(seen).toEqual([
            { notificationId: 'abc-123', data: { route: '/inbox' }, actionIdentifier: 'default' },
        ]);
    });

    it('drops a payload whose notificationId did not survive', () => {
        // The #342 signature: nested `data` arrives, sibling scalars vanish.
        // A consumer routes on notificationId — hand it nothing rather than a
        // partial it would deep-link from.
        const seen: unknown[] = [];
        addNotificationResponseListener((e) => seen.push(e));
        emitter.fire(RESP, JSON.stringify({ data: { route: '/inbox' } }));
        expect(seen).toEqual([]);
    });

    it('defaults actionIdentifier when absent', () => {
        const seen: unknown[] = [];
        addNotificationResponseListener((e) => seen.push(e));
        emitter.fire(RESP, JSON.stringify({ notificationId: 'n-1', data: {} }));
        expect(seen).toEqual([{ notificationId: 'n-1', data: {}, actionIdentifier: 'default' }]);
    });

    it('drops undefined and malformed payloads silently', () => {
        const seen: unknown[] = [];
        addNotificationResponseListener((e) => seen.push(e));
        emitter.fire(RESP, undefined);
        emitter.fire(RESP, '{not json');
        expect(seen).toEqual([]);
    });

    it('stops delivering after unsubscribe', () => {
        const seen: unknown[] = [];
        const unsub = addNotificationResponseListener((e) => seen.push(e));
        emitter.fire(RESP, JSON.stringify({ notificationId: 'first', data: {} }));
        unsub();
        emitter.fire(RESP, JSON.stringify({ notificationId: 'second', data: {} }));
        expect(seen).toEqual([
            { notificationId: 'first', data: {}, actionIdentifier: 'default' },
        ]);
    });
});
