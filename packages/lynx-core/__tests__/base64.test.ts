/**
 * Round-trip tests for the shared base64 ↔ ArrayBuffer codecs, exercising
 * BOTH paths: the native atob/btoa fast path and the pure-JS fallback
 * (stubbing the globals away).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { arrayBufferToBase64, base64ToArrayBuffer } from '../src/base64.js';

function bytes(...values: number[]): ArrayBuffer {
    return Uint8Array.from(values).buffer;
}

const CASES: Array<[string, ArrayBuffer]> = [
    ['empty', bytes()],
    ['one byte', bytes(0x41)],
    ['two bytes (padding =)', bytes(0x41, 0x42)],
    ['three bytes (no padding)', bytes(0x41, 0x42, 0x43)],
    ['binary incl. zero and 0xff', bytes(0x00, 0xff, 0x10, 0x80, 0x7f)],
    ['multi-byte UTF-8 text bytes', new TextEncoder().encode('héllo 🌍 åäö').buffer as ArrayBuffer],
];

function roundTrip(name: string, buf: ArrayBuffer): void {
    it(name, () => {
        const b64 = arrayBufferToBase64(buf);
        expect(new Uint8Array(base64ToArrayBuffer(b64))).toEqual(new Uint8Array(buf));
    });
}

describe('base64 codec round-trip (atob/btoa path)', () => {
    for (const [name, buf] of CASES) roundTrip(name, buf);

    it('handles large payloads beyond the fromCharCode chunk size', () => {
        const big = new Uint8Array(200_000);
        for (let i = 0; i < big.length; i++) big[i] = i % 256;
        const b64 = arrayBufferToBase64(big.buffer);
        expect(new Uint8Array(base64ToArrayBuffer(b64))).toEqual(big);
    });
});

describe('base64 codec round-trip (pure-JS fallback path)', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('round-trips without atob/btoa and matches the native encoding', () => {
        const buf = bytes(0x00, 0x01, 0xfe, 0xff, 0x41, 0x42, 0x43, 0x44);
        const nativeB64 = arrayBufferToBase64(buf);

        vi.stubGlobal('atob', undefined);
        vi.stubGlobal('btoa', undefined);

        const fallbackB64 = arrayBufferToBase64(buf);
        expect(fallbackB64).toBe(nativeB64);
        expect(new Uint8Array(base64ToArrayBuffer(fallbackB64))).toEqual(new Uint8Array(buf));
    });
});
