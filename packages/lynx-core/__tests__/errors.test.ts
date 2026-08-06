import { describe, expect, it } from 'vitest';

import { SigxError, isSigxError, unwrapNative, unwrapNativeVoid } from '../src/errors.js';

describe('SigxError', () => {
    it('carries a machine-readable code and the raising package', () => {
        const e = new SigxError('lynx-camera', 'permission_denied', 'no camera access');

        expect(e.code).toBe('permission_denied');
        expect(e.package).toBe('lynx-camera');
        expect(e.message).toBe('no camera access');
        expect(e.name).toBe('SigxError');
    });

    it('is a real Error, and instanceof survives subclassing', () => {
        // Subclassed builtins lose their prototype under some transpile
        // targets — the explicit setPrototypeOf in the constructor is what
        // keeps `catch (e) { if (e instanceof SigxError) }` working on device.
        class Derived extends SigxError {
            constructor() {
                super('lynx-updates', 'download_failed', 'boom');
            }
        }
        const e = new Derived();

        expect(e).toBeInstanceOf(Error);
        expect(e).toBeInstanceOf(SigxError);
        expect(e).toBeInstanceOf(Derived);
        expect(isSigxError(e)).toBe(true);
    });

    it('narrows unknown in a catch block', () => {
        expect(isSigxError(new Error('plain'))).toBe(false);
        expect(isSigxError('nope')).toBe(false);
        expect(isSigxError(null)).toBe(false);
    });
});

describe('unwrapNative', () => {
    it('passes a success payload straight through', () => {
        const raw = { uri: 'file:///photo.jpg', width: 100 };

        expect(unwrapNative('lynx-camera', 'takePicture', raw)).toBe(raw);
    });

    it('throws on the { error } envelope, with the C10 message format', () => {
        expect(() =>
            unwrapNative('lynx-camera', 'takePicture', { error: 'camera busy' }),
        ).toThrow('[@sigx/lynx-camera] takePicture failed: camera busy');
    });

    it('throws a SigxError carrying the code, package and original payload', () => {
        const raw = { error: 'camera busy' };
        try {
            unwrapNative('lynx-camera', 'takePicture', raw);
            expect.unreachable('should have thrown');
        } catch (e) {
            expect(isSigxError(e)).toBe(true);
            const err = e as SigxError;
            expect(err.code).toBe('native_error');
            expect(err.package).toBe('lynx-camera');
            expect(err.cause).toBe(raw);
        }
    });

    it('serializes a non-string error rather than printing [object Object]', () => {
        expect(() =>
            unwrapNative('lynx-sqlite', 'exec', { error: { code: 5, msg: 'locked' } }),
        ).toThrow('{"code":5,"msg":"locked"}');
    });

    it('treats a null or absent error as success', () => {
        // Some native paths always include the key; only a non-null value is a
        // failure, or every successful call would throw.
        expect(unwrapNative('lynx-storage', 'getItem', { error: null, value: 'v' })).toEqual({
            error: null,
            value: 'v',
        });
        expect(unwrapNative('lynx-storage', 'getItem', { value: 'v' })).toEqual({ value: 'v' });
    });

    it('passes through payloads that are not envelopes at all', () => {
        expect(unwrapNative('lynx-storage', 'getAllKeys', ['a', 'b'])).toEqual(['a', 'b']);
        expect(unwrapNative('lynx-network', 'getState', undefined)).toBeUndefined();
        expect(unwrapNative('lynx-network', 'getState', null)).toBeNull();
        expect(unwrapNative('lynx-clipboard', 'getString', 'hello')).toBe('hello');
    });
});

describe('unwrapNativeVoid', () => {
    it('returns nothing on success', () => {
        expect(unwrapNativeVoid('lynx-haptics', 'impact', undefined)).toBeUndefined();
    });

    it('throws on the { error } envelope', () => {
        expect(() => unwrapNativeVoid('lynx-storage', 'setItem', { error: 'disk full' })).toThrow(
            '[@sigx/lynx-storage] setItem failed: disk full',
        );
    });
});
