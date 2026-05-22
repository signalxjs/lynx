/**
 * Unit tests for the push listener shim. Mocks `@sigx/lynx-core` and stubs
 * `lynx.getJSModule('GlobalEventEmitter')` so we drive native event delivery
 * in-process. Real APNs/FCM round-trip is exercised on-device.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = {
    callAsync: vi.fn(async (..._args: unknown[]) => undefined),
    guardModule: vi.fn(),
    isModuleAvailable: vi.fn(() => true),
};

vi.mock('@sigx/lynx-core', () => ({
    callAsync: (...args: unknown[]) => bridge.callAsync(...(args as [])),
    guardModule: (...args: unknown[]) => bridge.guardModule(...(args as [])),
    isModuleAvailable: (...args: unknown[]) => bridge.isModuleAvailable(...(args as [])),
}));

type Listener = (...a: unknown[]) => void;
const emitter = {
    listeners: new Map<string, Set<Listener>>(),
    addListener(name: string, fn: Listener) {
        if (!this.listeners.has(name)) this.listeners.set(name, new Set());
        this.listeners.get(name)!.add(fn);
    },
    removeListener(name: string, fn: Listener) {
        this.listeners.get(name)?.delete(fn);
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

beforeEach(() => {
    bridge.callAsync.mockClear();
});

afterEach(() => {
    emitter.listeners.clear();
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
});
