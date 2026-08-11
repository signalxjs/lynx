/**
 * Native network surface — the path that ships on iOS and Android.
 *
 * Only the web shim was covered before, so the code that actually runs on
 * device had no tests at all. These drive the real `@sigx/lynx-core` bridge
 * against a faked `NativeModules` global, so the module-name and callback
 * conventions are exercised rather than mocked away.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Network } from '../src/network';

/** A plausible successful payload, matching what both native modules build. */
const CONNECTED = {
    isConnected: true,
    type: 'wifi',
    isInternetReachable: true,
} as const;

/** Records what crossed the bridge, so call shape is asserted, not assumed. */
let calls: Array<{ method: string; args: unknown[] }>;

/** Install a fake `Network` native module. `undefined` unlinks it. */
function installNativeModules(impl?: Record<string, (...a: never[]) => unknown>) {
    vi.stubGlobal('NativeModules', impl ? { Network: impl } : {});
}

/** A `getState` that replies with whatever payload the test cares about. */
function replyWith(payload: unknown) {
    installNativeModules({
        getState: (...args: never[]) => {
            calls.push({ method: 'getState', args: args.slice(0, -1) });
            (args[args.length - 1] as unknown as (r: unknown) => void)(payload);
        },
    });
}

beforeEach(() => {
    calls = [];
    replyWith(CONNECTED);
});

afterEach(() => vi.unstubAllGlobals());

describe('Network.getState', () => {
    it('resolves the state the native callback supplies', async () => {
        await expect(Network.getState()).resolves.toEqual(CONNECTED);
        expect(calls).toEqual([{ method: 'getState', args: [] }]);
    });

    it('resolves a genuinely offline device rather than treating it as a failure', async () => {
        // Offline is an answer, not an error — the one case most likely to be
        // confused with the `{ error }` envelope below.
        const offline = { isConnected: false, type: 'none', isInternetReachable: false };
        replyWith(offline);
        await expect(Network.getState()).resolves.toEqual(offline);
    });

    it('rejects when the native side reports an error', async () => {
        // The whole point of #894: Android wraps getState in a catch-all that
        // replies `{ error }`, and that used to be returned as a NetworkState
        // with every field undefined — so `if (state.isConnected)` silently
        // took the offline branch and no caller's catch ever ran.
        replyWith({ error: 'connectivity service unavailable' });
        await expect(Network.getState()).rejects.toThrow(
            '[@sigx/lynx-network] getState failed: connectivity service unavailable',
        );
    });

    it('rejects with a branchable code, not just a message', async () => {
        replyWith({ error: 'boom' });
        await expect(Network.getState()).rejects.toMatchObject({
            code: 'native_error',
            package: 'lynx-network',
        });
    });

    it('does not hand the error envelope back as a state object', async () => {
        // Guards the exact regression shape: a resolved value here means a
        // caller reads `isConnected: undefined` and believes the device is
        // offline.
        replyWith({ error: 'boom' });
        const result = await Network.getState().then(
            (state) => ({ settled: 'resolved' as const, state }),
            () => ({ settled: 'rejected' as const, state: undefined }),
        );
        expect(result.settled).toBe('rejected');
    });
});

describe('Network.isAvailable', () => {
    it('is true when the module is linked', () => {
        expect(Network.isAvailable()).toBe(true);
    });

    it('is false when it is not', () => {
        installNativeModules();
        expect(Network.isAvailable()).toBe(false);
    });

    it('is false, not a throw, with no NativeModules global at all', () => {
        // Off-device — web preview, SSR, tests. Feature detection has to work
        // there or every caller needs a try/catch.
        vi.unstubAllGlobals();
        expect(Network.isAvailable()).toBe(false);
    });

    it('returns a boolean synchronously (C2)', () => {
        // A Promise here would make `if (Network.isAvailable())` always true.
        expect(typeof Network.isAvailable()).toBe('boolean');
    });
});

describe('when the native module is not linked', () => {
    // C3: this package throws rather than silently reporting "offline", and
    // the error is the descriptive one from core's `getModule`.
    beforeEach(() => installNativeModules());

    it('getState rejects with an actionable message', async () => {
        await expect(Network.getState()).rejects.toThrow(/Module "Network" is not available/);
    });
});
