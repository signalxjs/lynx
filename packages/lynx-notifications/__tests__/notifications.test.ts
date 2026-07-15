/**
 * Unit tests for `getInitialNotification`'s wire contract.
 *
 * Native returns the cold-start tap as a JSON **string** — the payload nests
 * `data`, and a structured map loses its sibling scalars crossing the bridge
 * (#342), so `notificationId` / `actionIdentifier` would arrive `undefined`.
 * That decision moves the parsing into JS, which is the part vitest can pin
 * down; the native halves are exercised on-device.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = {
    callAsync: vi.fn(async (..._args: unknown[]) => undefined as unknown),
    guardModule: vi.fn(),
    isModuleAvailable: vi.fn(() => true),
};

vi.mock('@sigx/lynx-core', () => ({
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
