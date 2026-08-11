/**
 * Unit tests for the JS-side SecureStorage API. Real round-trip against a real
 * Keychain/Keystore is exercised on-device via examples/showcase.
 *
 * These drive the real `@sigx/lynx-core` bridge against a faked
 * `NativeModules` global rather than mocking the module out, matching the
 * sibling C4 conversions (lynx-clipboard, lynx-file-system). That matters
 * here: the thing under test *is* the unwrap of the `{ error }` envelope, and
 * a mocked-out core would only prove the mock throws. Both natives resolve
 * their callback with `{ error }` on failure — they never reject — so a
 * missing unwrap turns a failed read into a plausible-looking `null`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SecureStorage } from '../src/secure-storage.js';

type NativeImpl = Record<string, (...a: never[]) => unknown>;

/** Records what crossed the bridge, so call shape is asserted, not assumed. */
let calls: Array<{ method: string; args: unknown[] }>;

/** Install a fake `SecureStorage` native module. `undefined` unlinks it. */
function installNativeModules(impl?: NativeImpl) {
    vi.stubGlobal('NativeModules', impl ? { SecureStorage: impl } : {});
}

/**
 * A native method that records its arguments and resolves `result` — the
 * shape both platforms use: last argument is the callback, and a failure is a
 * resolved `{ error }`, never a throw.
 */
function resolving(method: string, result: unknown): (...a: never[]) => void {
    return (...args: never[]) => {
        const cb = args[args.length - 1] as unknown as (r: unknown) => void;
        calls.push({ method, args: args.slice(0, -1) });
        cb(result);
    };
}

/** Install one method's reply, leaving the others on their success default. */
function nativeReplying(method: string, result: unknown) {
    installNativeModules({
        set: resolving('set', { ok: true }),
        get: resolving('get', { value: 'stored' }),
        delete: resolving('delete', { ok: true }),
        clear: resolving('clear', { ok: true }),
        hasKey: resolving('hasKey', { exists: true }),
        [method]: resolving(method, result),
    });
}

beforeEach(() => {
    calls = [];
    nativeReplying('set', { ok: true });
});

afterEach(() => vi.unstubAllGlobals());

describe('SecureStorage.setItem', () => {
    it('forwards key, value, and opts to the native bridge', async () => {
        await SecureStorage.setItem('token', 'abc', { requireBiometric: true });
        expect(calls).toEqual([
            { method: 'set', args: ['token', 'abc', { requireBiometric: true }] },
        ]);
    });

    it('defaults opts to an empty object', async () => {
        await SecureStorage.setItem('token', 'abc');
        expect(calls).toEqual([{ method: 'set', args: ['token', 'abc', {}] }]);
    });

    it('throws a SigxError when native returns { error }', async () => {
        nativeReplying('set', { error: 'keychain locked' });
        await expect(SecureStorage.setItem('token', 'abc')).rejects.toMatchObject({
            name: 'SigxError',
            code: 'native_error',
            package: 'lynx-secure-storage',
            message: '[@sigx/lynx-secure-storage] setItem(token) failed: keychain locked',
        });
    });

    it('throws when native acknowledges nothing', async () => {
        // A write that reports neither `ok` nor `error` never happened; saying
        // "stored" here is how a credential silently goes missing.
        nativeReplying('set', {});
        await expect(SecureStorage.setItem('token', 'abc')).rejects.toThrow(
            /setItem\(token\) failed: native did not acknowledge the write/,
        );
    });

    it('throws on empty key', async () => {
        await expect(SecureStorage.setItem('', 'abc')).rejects.toThrow(/non-empty string/);
        expect(calls).toEqual([]);
    });

    it('throws on a non-string value', async () => {
        await expect(
            SecureStorage.setItem('token', 42 as unknown as string),
        ).rejects.toThrow(/value must be a string/);
        expect(calls).toEqual([]);
    });
});

describe('SecureStorage.getItem', () => {
    it('forwards key + opts and returns the value', async () => {
        nativeReplying('get', { value: 'abc' });
        const value = await SecureStorage.getItem('token', {
            biometricPrompt: { reason: 'Unlock', title: 'Acme' },
        });
        expect(value).toBe('abc');
        expect(calls).toEqual([
            {
                method: 'get',
                args: ['token', { biometricPrompt: { reason: 'Unlock', title: 'Acme' } }],
            },
        ]);
    });

    it('returns null when native returns no value', async () => {
        nativeReplying('get', { value: null });
        expect(await SecureStorage.getItem('missing')).toBeNull();
    });

    it('returns null when native omits value entirely', async () => {
        nativeReplying('get', {});
        expect(await SecureStorage.getItem('missing')).toBeNull();
    });

    it('throws a SigxError carrying the native payload as cause', async () => {
        const payload = { error: 'Keystore key missing or invalidated: bad key' };
        nativeReplying('get', payload);
        const err = await SecureStorage.getItem('token').catch((e: unknown) => e);
        expect(err).toMatchObject({
            name: 'SigxError',
            code: 'native_error',
            cause: payload,
        });
        expect((err as Error).message).toBe(
            '[@sigx/lynx-secure-storage] getItem(token) failed: Keystore key missing or invalidated: bad key',
        );
    });

    it('throws on empty key', async () => {
        // Rejects rather than resolving `null`: an empty key is a caller bug,
        // not a key that happens to be unset.
        await expect(SecureStorage.getItem('')).rejects.toThrow(/non-empty string/);
        expect(calls).toEqual([]);
    });

    it('throws — never resolves null — when the user dismisses the prompt', async () => {
        // C5 in reverse: this package has no `cancelled` result to preserve.
        // Both natives report a dismiss as `{ error: 'userCancel' }`
        // (swift:136 errSecUserCanceled, kt:270 ERROR_NEGATIVE_BUTTON), so a
        // dismiss is a failure here and always was. The value of the test is
        // that it can't degrade into `null`, which callers read as "signed
        // out" and act on.
        nativeReplying('get', { error: 'userCancel' });
        await expect(SecureStorage.getItem('token')).rejects.toThrow(
            /getItem\(token\) failed: userCancel/,
        );
    });
});

describe('SecureStorage.removeItem', () => {
    it('forwards the key', async () => {
        nativeReplying('delete', { ok: true });
        await SecureStorage.removeItem('token');
        expect(calls).toEqual([{ method: 'delete', args: ['token'] }]);
    });

    it('throws when native returns { error }', async () => {
        nativeReplying('delete', { error: 'SecItemDelete failed: -34018' });
        await expect(SecureStorage.removeItem('token')).rejects.toMatchObject({
            code: 'native_error',
            message:
                '[@sigx/lynx-secure-storage] removeItem(token) failed: SecItemDelete failed: -34018',
        });
    });

    it('throws on empty key', async () => {
        await expect(SecureStorage.removeItem('')).rejects.toThrow(/non-empty string/);
        expect(calls).toEqual([]);
    });
});

describe('SecureStorage.clear', () => {
    it('calls native with no arguments', async () => {
        nativeReplying('clear', { ok: true });
        await SecureStorage.clear();
        expect(calls).toEqual([{ method: 'clear', args: [] }]);
    });

    it('throws when native returns { error }', async () => {
        nativeReplying('clear', { error: 'clear failed: IOException' });
        await expect(SecureStorage.clear()).rejects.toMatchObject({
            code: 'native_error',
            message: '[@sigx/lynx-secure-storage] clear failed: clear failed: IOException',
        });
    });
});

describe('SecureStorage.hasKey', () => {
    it('returns the exists flag from native', async () => {
        nativeReplying('hasKey', { exists: true });
        expect(await SecureStorage.hasKey('token')).toBe(true);
        nativeReplying('hasKey', { exists: false });
        expect(await SecureStorage.hasKey('token')).toBe(false);
    });

    it('returns false (without calling native) on empty key', async () => {
        expect(await SecureStorage.hasKey('')).toBe(false);
        expect(calls).toEqual([]);
    });

    it('throws when native returns { error }', async () => {
        nativeReplying('hasKey', { error: 'prefs unreadable' });
        await expect(SecureStorage.hasKey('token')).rejects.toMatchObject({
            code: 'native_error',
            message: '[@sigx/lynx-secure-storage] hasKey(token) failed: prefs unreadable',
        });
    });
});

describe('SecureStorage.isAvailable', () => {
    it('reflects whether the native module is linked', () => {
        expect(SecureStorage.isAvailable()).toBe(true);
        installNativeModules(undefined);
        expect(SecureStorage.isAvailable()).toBe(false);
    });
});

describe('without the native module', () => {
    beforeEach(() => installNativeModules(undefined));

    // The README promises every call rejects with core's descriptive error;
    // this is the only failure that arrives as a rejection rather than an
    // `{ error }` envelope, so it must not be confused with one.
    it('rejects every call with core’s descriptive error', async () => {
        await expect(SecureStorage.setItem('k', 'v')).rejects.toThrow(
            /Module "SecureStorage" is not available/,
        );
        await expect(SecureStorage.getItem('k')).rejects.toThrow(
            /Module "SecureStorage" is not available/,
        );
        await expect(SecureStorage.removeItem('k')).rejects.toThrow(
            /Module "SecureStorage" is not available/,
        );
        await expect(SecureStorage.clear()).rejects.toThrow(
            /Module "SecureStorage" is not available/,
        );
        await expect(SecureStorage.hasKey('k')).rejects.toThrow(
            /Module "SecureStorage" is not available/,
        );
    });
});
