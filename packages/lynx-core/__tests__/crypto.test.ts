/**
 * getRandomBytes (#1337) — Web Crypto first, then core's native CSPRNG
 * (`SigxCore.getRandomBytes`, base64 over the bridge), and never a weak
 * fallback. Vitest runs JS only; the `NativeModules` mock stands in for the
 * Swift/Kotlin `DeviceInfoModule.getRandomBytes`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getRandomBytes } from '../src/crypto.js';
import { arrayBufferToBase64 } from '../src/base64.js';
import { isSigxError } from '../src/errors.js';

type Globals = Record<string, unknown>;

function mockNative(impl: (length: number) => unknown): ReturnType<typeof vi.fn> {
    const fn = vi.fn(impl);
    (globalThis as Globals).NativeModules = { SigxCore: { getRandomBytes: fn } };
    return fn;
}

function expectCode(fn: () => unknown, code: string): void {
    try {
        fn();
    } catch (err) {
        expect(isSigxError(err)).toBe(true);
        expect((err as { code: string }).code).toBe(code);
        return;
    }
    throw new Error(`expected a SigxError with code ${code}`);
}

afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as Globals).NativeModules;
});

describe('getRandomBytes', () => {
    it('prefers crypto.getRandomValues when the runtime has it', () => {
        const native = mockNative(() => '');
        const bytes = getRandomBytes(32);
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.length).toBe(32);
        expect(native).not.toHaveBeenCalled();
    });

    it('falls back to the native SigxCore CSPRNG without Web Crypto', () => {
        vi.stubGlobal('crypto', undefined);
        const raw = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
        const native = mockNative(() => arrayBufferToBase64(raw));
        const bytes = getRandomBytes(raw.length);
        expect(native).toHaveBeenCalledWith(raw.length);
        expect(Array.from(bytes)).toEqual(Array.from(raw));
    });

    it('throws no_random_source with no Web Crypto and no native module', () => {
        vi.stubGlobal('crypto', undefined);
        expectCode(() => getRandomBytes(16), 'no_random_source');
    });

    it('throws no_random_source when native returns empty (refused or failed)', () => {
        vi.stubGlobal('crypto', undefined);
        mockNative(() => '');
        expectCode(() => getRandomBytes(16), 'no_random_source');
    });

    it('throws no_random_source when native returns fewer bytes than asked for', () => {
        vi.stubGlobal('crypto', undefined);
        mockNative(() => arrayBufferToBase64(new Uint8Array(8)));
        expectCode(() => getRandomBytes(16), 'no_random_source');
    });

    it.each([0, -1, 1.5, 1025, Number.NaN])('rejects length %s with invalid_argument', (n) => {
        expectCode(() => getRandomBytes(n), 'invalid_argument');
    });
});
