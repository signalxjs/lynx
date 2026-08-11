/**
 * Native location surface — the path that ships on iOS and Android.
 *
 * Only the web shim was covered before, so the code that actually runs on
 * device had no tests. These drive the real `@sigx/lynx-core` bridge against a
 * faked `NativeModules` global, so the `{ error }` envelope both natives
 * resolve on failure is exercised end to end rather than mocked away.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Location } from '../src/location';

/** Records what crossed the bridge, so call shape is asserted, not assumed. */
let calls: Array<{ method: string; args: unknown[] }>;

const FIX = {
    latitude: 59.33,
    longitude: 18.06,
    altitude: 21.4,
    accuracy: 12,
    speed: null,
    heading: null,
    timestamp: 1_770_000_000_000,
};

type NativeMethod = (...a: never[]) => unknown;

/** Install a fake `Location` native module. `undefined` unlinks it. */
function installNativeModules(impl?: Record<string, NativeMethod>) {
    vi.stubGlobal('NativeModules', impl ? { Location: impl } : {});
}

/**
 * A native method that records its arguments and invokes the trailing
 * callback with `payload` — the shape both `LocationModule.swift` and
 * `LocationModule.kt` use for success *and* failure.
 */
function replying(method: string, payload: unknown): NativeMethod {
    return ((...args: never[]) => {
        const cb = args[args.length - 1] as unknown as (r: unknown) => void;
        calls.push({ method, args: args.slice(0, -1) });
        cb(payload);
    }) as NativeMethod;
}

beforeEach(() => {
    calls = [];
    installNativeModules({
        getCurrentPosition: replying('getCurrentPosition', FIX),
        requestPermission: replying('requestPermission', { status: 'granted', canAskAgain: false }),
        getPermissionStatus: replying('getPermissionStatus', {
            status: 'granted',
            canAskAgain: false,
        }),
    });
});

afterEach(() => vi.unstubAllGlobals());

describe('Location.getCurrentPosition', () => {
    it('resolves the fix the native callback supplies, forwarding options', async () => {
        await expect(
            Location.getCurrentPosition({ accuracy: 'high', timeout: 5000 }),
        ).resolves.toEqual(FIX);
        expect(calls).toEqual([
            { method: 'getCurrentPosition', args: [{ accuracy: 'high', timeout: 5000 }] },
        ]);
    });

    it('sends an options object even when called bare', async () => {
        // Both natives read `options` as a map; omitting the argument would
        // shift the callback into the options slot.
        await Location.getCurrentPosition();
        expect(calls).toEqual([{ method: 'getCurrentPosition', args: [{}] }]);
    });

    it('rejects when the platform refuses the fix (C4)', async () => {
        // Permission-denied is a *resolved* `{ error }` on both platforms
        // (`ios/LocationModule.swift:35`, `android/…/LocationModule.kt:35`).
        // Before the unwrap this resolved a LocationResult whose every field
        // was `undefined`, and the showcase crashed in render on
        // `fix.lat.toFixed(5)` because its `catch` never ran.
        installNativeModules({
            getCurrentPosition: replying('getCurrentPosition', {
                error: 'Location permission not granted',
            }),
        });
        await expect(Location.getCurrentPosition()).rejects.toThrow(
            '[@sigx/lynx-location] getCurrentPosition failed: Location permission not granted',
        );
    });

    it('rejects when no fix is available, rather than resolving undefined fields', async () => {
        installNativeModules({
            getCurrentPosition: replying('getCurrentPosition', {
                error: 'Unable to get current location',
            }),
        });
        // The degraded shape is what this replaces: assert the caller can't
        // reach a `latitude` at all.
        await expect(Location.getCurrentPosition()).rejects.toMatchObject({
            code: 'native_error',
            package: 'lynx-location',
        });
    });

    it('throws the descriptive core error when the module is not linked (C3)', async () => {
        installNativeModules();
        await expect(Location.getCurrentPosition()).rejects.toThrow(
            /Module "Location" is not available/,
        );
    });
});

describe('Location permission methods', () => {
    it('resolve the permission envelope', async () => {
        await expect(Location.requestPermission()).resolves.toEqual({
            status: 'granted',
            canAskAgain: false,
        });
        await expect(Location.getPermissionStatus()).resolves.toEqual({
            status: 'granted',
            canAskAgain: false,
        });
        expect(calls.map((c) => c.method)).toEqual(['requestPermission', 'getPermissionStatus']);
    });

    it('resolve a denial rather than throwing — a refusal is not a failure', async () => {
        // C5's shape of the same idea: the user saying no is an outcome the
        // caller branches on (`status` + `canAskAgain` → re-prompt or deep-link
        // to Settings), not an error channel. Only `{ error }` rejects.
        installNativeModules({
            requestPermission: replying('requestPermission', {
                status: 'blocked',
                canAskAgain: false,
            }),
            getPermissionStatus: replying('getPermissionStatus', {
                status: 'denied',
                canAskAgain: true,
            }),
        });
        await expect(Location.requestPermission()).resolves.toEqual({
            status: 'blocked',
            canAskAgain: false,
        });
        await expect(Location.getPermissionStatus()).resolves.toEqual({
            status: 'denied',
            canAskAgain: true,
        });
    });

    it('reject when the native side reports an error (C4)', async () => {
        installNativeModules({
            requestPermission: replying('requestPermission', { error: 'no Activity' }),
            getPermissionStatus: replying('getPermissionStatus', { error: 'no Activity' }),
        });
        await expect(Location.requestPermission()).rejects.toThrow(
            '[@sigx/lynx-location] requestPermission failed: no Activity',
        );
        await expect(Location.getPermissionStatus()).rejects.toThrow(
            '[@sigx/lynx-location] getPermissionStatus failed: no Activity',
        );
    });
});

describe('Location.isAvailable', () => {
    it('reports whether the native module is linked (C2)', () => {
        expect(Location.isAvailable()).toBe(true);
        installNativeModules();
        expect(Location.isAvailable()).toBe(false);
    });
});
