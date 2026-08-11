/**
 * Unit tests for the native call contract: `getInitialNotification`'s wire
 * shape, and which methods reject on the `{ error }` envelope (C4).
 *
 * Native returns the cold-start tap as a JSON **string** — the payload nests
 * `data`, and a structured map loses its sibling scalars crossing the bridge
 * (#342), so `notificationId` / `actionIdentifier` would arrive `undefined`.
 * That decision moves the parsing into JS, which is the part vitest can pin
 * down; the native halves are exercised on-device.
 *
 * Only `callAsync` is faked below — `unwrapNative` is core's real one, so
 * these assert the shim's behaviour rather than the mock's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isSigxError } from '@sigx/lynx-core';

const bridge = {
    callAsync: vi.fn(async (..._args: unknown[]) => undefined as unknown),
    guardModule: vi.fn(),
    isModuleAvailable: vi.fn(() => true),
};

// Only the bridge calls are faked — `push.ts` subscribes through core's real
// `subscribeNative` (C7), so the module has to keep its other exports.
vi.mock('@sigx/lynx-core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@sigx/lynx-core')>()),
    callAsync: (...args: unknown[]) => bridge.callAsync(...(args as [])),
    guardModule: (...args: unknown[]) => bridge.guardModule(...(args as [])),
    isModuleAvailable: (...args: unknown[]) => bridge.isModuleAvailable(...(args as [])),
}));

// `push.ts` reads `lynx` lazily for the event channels; `notifications.ts`
// imports it, so the global must exist before the dynamic import below.
(globalThis as unknown as { lynx: unknown }).lynx = {
    getJSModule: () => undefined,
};

const { Notifications } = await import('../src/notifications.js');

/** What the native side actually sends. */
function nativePayload(over: Record<string, unknown> = {}) {
    return JSON.stringify({
        notificationId: 'n-1',
        data: { route: '/thread/123' },
        actionIdentifier: 'default',
        ...over,
    });
}

describe('getInitialNotification', () => {
    beforeEach(() => {
        bridge.callAsync.mockClear();
    });

    it('parses the JSON string native returns', async () => {
        bridge.callAsync.mockResolvedValueOnce(nativePayload());
        expect(await Notifications.getInitialNotification()).toEqual({
            notificationId: 'n-1',
            data: { route: '/thread/123' },
            actionIdentifier: 'default',
        });
    });

    it('calls the native method by its registered name', async () => {
        bridge.callAsync.mockResolvedValueOnce(nativePayload());
        await Notifications.getInitialNotification();
        // Pins the JS call against the native `methodLookup` / @LynxMethod name.
        expect(bridge.callAsync).toHaveBeenCalledWith('Notifications', 'getInitialNotification');
    });

    it('accepts an already-structured payload', async () => {
        // A host that marshals maps faithfully hands back an object; the shim
        // must not depend on the JSON-string workaround being necessary.
        bridge.callAsync.mockResolvedValueOnce({
            notificationId: 'n-2',
            data: {},
            actionIdentifier: 'default',
        });
        expect(await Notifications.getInitialNotification()).toEqual({
            notificationId: 'n-2',
            data: {},
            actionIdentifier: 'default',
        });
    });

    // Which of these `NSNull()` / Kotlin `null` marshals to is unverified, so
    // every plausible shape must read as "no cold-start tap".
    it.each([
        ['null', null],
        ['undefined', undefined],
        ['an empty object', {}],
    ])('returns null for %s', async (_label, value) => {
        bridge.callAsync.mockResolvedValueOnce(value);
        expect(await Notifications.getInitialNotification()).toBeNull();
    });

    it('returns null for a top-level array payload', async () => {
        // Arrays are objects in JS — the "plain object" contract is enforced,
        // not implied.
        bridge.callAsync.mockResolvedValueOnce(JSON.stringify([{ notificationId: 'n-1' }]));
        expect(await Notifications.getInitialNotification()).toBeNull();
    });

    it('returns null for malformed JSON rather than throwing', async () => {
        bridge.callAsync.mockResolvedValueOnce('{not json');
        expect(await Notifications.getInitialNotification()).toBeNull();
    });

    it('returns null when notificationId did not survive', async () => {
        // The #342 signature: nested `data` arrives, sibling scalars vanish.
        // Routing on a partial would deep-link with no id — treat as no tap.
        bridge.callAsync.mockResolvedValueOnce(JSON.stringify({ data: { route: '/x' } }));
        expect(await Notifications.getInitialNotification()).toBeNull();
    });

    it('defaults actionIdentifier and data when absent', async () => {
        bridge.callAsync.mockResolvedValueOnce(JSON.stringify({ notificationId: 'n-3' }));
        expect(await Notifications.getInitialNotification()).toEqual({
            notificationId: 'n-3',
            data: {},
            actionIdentifier: 'default',
        });
    });

    it('drops data values that are not strings', async () => {
        // The wire type is Record<string, string> and both platforms only send
        // strings. A non-string means the payload isn't what it claims — drop
        // the key rather than hand back a value contradicting the signature.
        bridge.callAsync.mockResolvedValueOnce(JSON.stringify({
            notificationId: 'n-4',
            data: { route: '/ok', count: 7, nested: { a: 1 }, gone: null },
        }));
        const res = await Notifications.getInitialNotification();
        expect(res!.data).toEqual({ route: '/ok' });
    });

    it('treats an array data payload as empty', async () => {
        // Arrays are objects in JS — without an explicit reject, `data` would
        // come back with numeric keys.
        bridge.callAsync.mockResolvedValueOnce(JSON.stringify({
            notificationId: 'n-5',
            data: ['a', 'b'],
        }));
        expect((await Notifications.getInitialNotification())!.data).toEqual({});
    });

    it('round-trips a nested iOS data value as a parseable JSON string', async () => {
        // iOS JSON-encodes non-string APNs custom values, so a nested object
        // recovers via JSON.parse rather than arriving as a Swift debug
        // description (`{ id = 42; }`).
        bridge.callAsync.mockResolvedValueOnce(nativePayload({
            data: { route: JSON.stringify({ id: 42 }) },
        }));
        const res = await Notifications.getInitialNotification();
        expect(JSON.parse(res!.data['route']!)).toEqual({ id: 42 });
    });
});

describe('native { error } envelopes (C4)', () => {
    beforeEach(() => {
        bridge.callAsync.mockClear();
    });

    describe('schedule', () => {
        it('resolves the notification id when native succeeds', async () => {
            bridge.callAsync.mockResolvedValueOnce('n-42');
            await expect(
                Notifications.schedule({ title: 'Hi', body: 'There' }, { delay: 5 }),
            ).resolves.toBe('n-42');
            // Pins the JS call against the native `methodLookup` / @LynxMethod
            // name and argument order.
            expect(bridge.callAsync).toHaveBeenCalledWith(
                'Notifications',
                'schedule',
                { title: 'Hi', body: 'There' },
                { delay: 5 },
            );
        });

        it('rejects when the OS refused the notification', async () => {
            // `UNUserNotificationCenter.add`'s error (iOS) and the builder
            // exception (Android) both arrive on the *resolved* callback, so
            // this used to fulfil with an object typed `string` — the caller
            // held an id that cancels nothing and never knew.
            bridge.callAsync.mockResolvedValueOnce({
                error: 'Notifications are not allowed for this application',
            });
            await expect(
                Notifications.schedule({ title: 'Hi', body: 'There' }),
            ).rejects.toThrow(
                '[@sigx/lynx-notifications] schedule failed: Notifications are not allowed for this application',
            );
        });

        it('rejects with a branchable SigxError (C10)', async () => {
            bridge.callAsync.mockResolvedValueOnce({ error: 'boom' });
            const err = await Notifications.schedule({ title: 'a', body: 'b' }).catch(
                (e: unknown) => e,
            );
            expect(isSigxError(err)).toBe(true);
            expect(err).toMatchObject({ code: 'native_error', package: 'lynx-notifications' });
        });
    });

    describe('setBadgeCount', () => {
        it('resolves when native succeeds', async () => {
            // Both natives answer `true`; the surface stays `Promise<void>`.
            bridge.callAsync.mockResolvedValueOnce(true);
            await expect(Notifications.setBadgeCount(3)).resolves.toBeUndefined();
            expect(bridge.callAsync).toHaveBeenCalledWith('Notifications', 'setBadgeCount', 3);
        });

        it('rejects when iOS reports a badge error', async () => {
            // iOS 16+'s setBadgeCount completion carries an error; the old
            // `Promise<void>` discarded it, so a badge that never changed was
            // indistinguishable from one that did.
            bridge.callAsync.mockResolvedValueOnce({ error: 'Notification settings unavailable' });
            await expect(Notifications.setBadgeCount(3)).rejects.toThrow(
                '[@sigx/lynx-notifications] setBadgeCount failed: Notification settings unavailable',
            );
        });
    });

    describe('documented C3 opt-outs still return their failure as a value', () => {
        // These are not oversights — each is documented in the method's JSDoc
        // and the README's Gotchas. Pinned here so a later sweep can't turn
        // them into throws without deleting a test that says why.

        it('cancel / cancelAll resolve false rather than throwing', async () => {
            bridge.callAsync.mockResolvedValueOnce(false);
            await expect(Notifications.cancel('missing')).resolves.toBe(false);
            bridge.callAsync.mockResolvedValueOnce(false);
            await expect(Notifications.cancelAll()).resolves.toBe(false);
        });

        it('push registration resolves its error field rather than throwing', async () => {
            // The same failure is published on `addTokenErrorListener` first —
            // on iOS that channel is the only place it can ever surface.
            bridge.callAsync.mockResolvedValueOnce({ error: 'FCM token unavailable' });
            await expect(Notifications.registerForPushNotifications()).resolves.toEqual({
                error: 'FCM token unavailable',
            });
            bridge.callAsync.mockResolvedValueOnce({ ok: false, error: 'network' });
            await expect(Notifications.unregisterForPushNotifications()).resolves.toEqual({
                ok: false,
                error: 'network',
            });
        });

        it('a denied permission stays a status, not a rejection', async () => {
            // iOS folds an authorization error into `{ status: 'denied', error }`;
            // the C6 mapping question is tracked on #895, so this must not
            // start rejecting as a side effect of the C4 sweep.
            bridge.callAsync.mockResolvedValueOnce({ status: 'denied', error: 'no entitlement' });
            await expect(Notifications.requestPermission()).resolves.toMatchObject({
                status: 'denied',
            });
        });
    });
});
