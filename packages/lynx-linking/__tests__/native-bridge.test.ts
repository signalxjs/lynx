/**
 * The native `Linking` bridge methods, driven through a faked `NativeModules`
 * global.
 *
 * Only the global is faked: the real `callAsync` and the real
 * `unwrapNativeVoid` run, so these assert what a caller actually gets rather
 * than what a mocked core returned. That matters here — the bug these cover
 * is precisely that `callAsync` resolves the `{ error }` envelope as success
 * (it rejects only when the synchronous call into the bridge throws), so a
 * test that stubbed the package's own unwrap would have passed all along.
 */
import { isSigxError } from '@sigx/lynx-core';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { BackHandler } from '../src/back-handler';
import { Linking } from '../src/linking';

type Callback = (result: unknown) => void;

/** What native resolves for each method, per test. */
let responders: Map<string, (args: unknown[]) => unknown>;
let calls: { method: string; args: unknown[] }[];

function respond(method: string, args: unknown[]): unknown {
    calls.push({ method, args });
    const responder = responders.get(method);
    if (!responder) throw new Error(`test did not stub a response for ${method}`);
    return responder(args);
}

/** Await a promise expected to reject, returning the reason. */
async function rejection(p: Promise<unknown>): Promise<unknown> {
    try {
        await p;
    } catch (e) {
        return e;
    }
    throw new Error('expected the promise to reject, but it resolved');
}

beforeEach(() => {
    responders = new Map();
    calls = [];
    vi.stubGlobal('NativeModules', {
        Linking: {
            openURL: (url: string, cb: Callback) => cb(respond('openURL', [url])),
            canOpenURL: (url: string, cb: Callback) => cb(respond('canOpenURL', [url])),
            exitApp: (cb: Callback) => cb(respond('exitApp', [])),
        },
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('Linking.openURL', () => {
    it('resolves on the Android success shape (an empty map)', async () => {
        responders.set('openURL', () => ({}));
        await expect(Linking.openURL('https://lynxjs.org')).resolves.toBeUndefined();
        expect(calls).toEqual([{ method: 'openURL', args: ['https://lynxjs.org'] }]);
    });

    it('resolves on the iOS success shape (a null callback payload)', async () => {
        // iOS passes `NSNull()`, which arrives as `null` — the unwrap must not
        // mistake it for a failure envelope.
        responders.set('openURL', () => null);
        await expect(Linking.openURL('tel:+15551234')).resolves.toBeUndefined();
    });

    it('throws when the OS refused to open the URL (C4)', async () => {
        // `UIApplication.open` completing with success=false, or Android's
        // ActivityNotFoundException — both arrive resolved, not rejected.
        responders.set('openURL', () => ({ error: 'Failed to open URL' }));
        const error = await rejection(Linking.openURL('whatsapp://send'));
        if (!isSigxError(error)) throw new Error('expected a SigxError');
        expect(error.code).toBe('native_error');
        expect(error.package).toBe('lynx-linking');
        expect(error.message).toBe('[@sigx/lynx-linking] openURL failed: Failed to open URL');
        expect(error.cause).toEqual({ error: 'Failed to open URL' });
    });

    it('throws when native rejected the URL as malformed', async () => {
        responders.set('openURL', () => ({ error: 'Invalid URL' }));
        const error = await rejection(Linking.openURL('not a url'));
        expect((error as Error).message).toBe('[@sigx/lynx-linking] openURL failed: Invalid URL');
    });

    it("rejects with core's actionable error when the module is not linked", async () => {
        vi.stubGlobal('NativeModules', {});
        const error = await rejection(Linking.openURL('https://lynxjs.org'));
        expect((error as Error).message).toContain('Module "Linking" is not available');
    });
});

describe('Linking.canOpenURL', () => {
    // `false` is an answer, not a failure — a scheme nothing handles must stay
    // a resolved `false`, or every "can I deep-link into that app?" check
    // becomes a thrown error in the common path.
    it('resolves false for a scheme nothing handles', async () => {
        responders.set('canOpenURL', () => false);
        await expect(Linking.canOpenURL('whatsapp://send')).resolves.toBe(false);
    });

    it('resolves true for a handled scheme', async () => {
        responders.set('canOpenURL', () => true);
        await expect(Linking.canOpenURL('https://lynxjs.org')).resolves.toBe(true);
    });
});

describe('Linking.isAvailable', () => {
    it('follows whether the module is registered', () => {
        expect(Linking.isAvailable()).toBe(true);
        vi.stubGlobal('NativeModules', {});
        expect(Linking.isAvailable()).toBe(false);
    });
});

describe('BackHandler.exitApp', () => {
    it('resolves when Android moved the task to the back', async () => {
        responders.set('exitApp', () => ({}));
        await expect(BackHandler.exitApp()).resolves.toBeUndefined();
        expect(calls).toEqual([{ method: 'exitApp', args: [] }]);
    });

    it('throws on iOS, where programmatic termination is forbidden (C4)', async () => {
        responders.set('exitApp', () => ({ error: 'exitApp is not supported on iOS' }));
        const error = await rejection(BackHandler.exitApp());
        if (!isSigxError(error)) throw new Error('expected a SigxError');
        expect(error.code).toBe('native_error');
        expect(error.message).toBe(
            '[@sigx/lynx-linking] exitApp failed: exitApp is not supported on iOS',
        );
    });

    it('throws when Android found no hosting Activity', async () => {
        responders.set('exitApp', () => ({ error: 'No hosting Activity found' }));
        const error = await rejection(BackHandler.exitApp());
        expect((error as Error).message).toBe(
            '[@sigx/lynx-linking] exitApp failed: No hosting Activity found',
        );
    });
});
