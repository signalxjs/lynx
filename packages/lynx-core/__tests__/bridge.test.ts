/**
 * The bridge's failure shape.
 *
 * `getModule` is where "the native module isn't linked" is decided for every
 * `@sigx/lynx-*` package, so it is the other half of the error contract next to
 * `unwrapNative`'s `'native_error'` — and the half a caller could only match by
 * message until it grew a `code` (C10).
 */
import { afterEach, describe, expect, it } from 'vitest';

import { callAsync, callSync, getModule, guardModule, isModuleAvailable } from '../src/bridge.js';
import { isSigxError, type SigxError } from '../src/errors.js';

type Globals = Record<string, unknown>;

afterEach(() => {
    delete (globalThis as Globals).NativeModules;
});

/** Grab the throw as a SigxError, failing the test if it isn't one. */
function catchSigx(fn: () => unknown): SigxError {
    try {
        fn();
    } catch (e) {
        expect(isSigxError(e)).toBe(true);
        return e as SigxError;
    }
    return expect.unreachable('should have thrown') as never;
}

describe('getModule', () => {
    it('returns the registered module', () => {
        const clipboard = { getString: () => 'hi' };
        (globalThis as Globals).NativeModules = { Clipboard: clipboard };

        expect(getModule('Clipboard')).toBe(clipboard);
    });

    it('throws a SigxError with code module_unavailable when nothing is registered', () => {
        const err = catchSigx(() => getModule('Clipboard'));

        expect(err.code).toBe('module_unavailable');
        expect(err.package).toBe('lynx-core');
        expect(err).toBeInstanceOf(Error);
    });

    it('names the package to install, so the message stays actionable', () => {
        (globalThis as Globals).NativeModules = {};

        expect(() => getModule('SecureStorage')).toThrow(
            /Module "SecureStorage" is not available/,
        );
        expect(() => getModule('SecureStorage')).toThrow(/@sigx\/lynx-secure-storage/);
    });

    it('falls back to a derived package name for an unmapped module', () => {
        (globalThis as Globals).NativeModules = {};

        expect(() => getModule('Mystery')).toThrow(/@sigx\/lynx-mystery/);
    });
});

describe('callSync / callAsync / guardModule', () => {
    it('callSync surfaces the same coded error', () => {
        expect(catchSigx(() => callSync('Clipboard', 'getString')).code).toBe(
            'module_unavailable',
        );
    });

    it('callAsync rejects rather than throwing synchronously', async () => {
        // The sync throw inside the Promise executor is caught and turned into
        // a rejection — an `await`ing caller must see it as one.
        await expect(callAsync('Clipboard', 'getString')).rejects.toMatchObject({
            code: 'module_unavailable',
        });
    });

    it('callAsync resolves the callback argument', async () => {
        (globalThis as Globals).NativeModules = {
            Clipboard: { getString: (cb: (v: string) => void) => cb('hi') },
        };

        await expect(callAsync<string>('Clipboard', 'getString')).resolves.toBe('hi');
    });

    it('guardModule throws only when the module is missing', () => {
        expect(catchSigx(() => guardModule('Clipboard')).code).toBe('module_unavailable');

        (globalThis as Globals).NativeModules = { Clipboard: { getString: () => 'hi' } };
        expect(() => guardModule('Clipboard')).not.toThrow();
    });
});

describe('isModuleAvailable', () => {
    it('is false with no NativeModules global and true once registered', () => {
        expect(isModuleAvailable('Clipboard')).toBe(false);

        (globalThis as Globals).NativeModules = { Clipboard: { getString: () => 'hi' } };
        expect(isModuleAvailable('Clipboard')).toBe(true);
        expect(isModuleAvailable('Camera')).toBe(false);
    });
});
