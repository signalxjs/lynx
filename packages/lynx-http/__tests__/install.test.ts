/**
 * Global-install precedence: when the Http native module is linked, the
 * sigx fetch stack REPLACES an engine-provided fetch (engines without
 * FormData/streaming would break uploads); the TextDecoder shim only
 * fills a gap. Run in one file so the import-time side effect is isolated
 * to this worker; the original globals are restored afterwards.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@sigx/lynx-core', () => ({
    callAsync: vi.fn(async () => undefined),
    guardModule: vi.fn(),
    isModuleAvailable: vi.fn(() => true), // pretend the Http module is linked
    base64ToArrayBuffer: (b64: string) => {
        const buf = Buffer.from(b64, 'base64');
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
    arrayBufferToBase64: (buf: ArrayBuffer) => Buffer.from(buf).toString('base64'),
}));

const original = {
    fetch: globalThis.fetch,
    Headers: globalThis.Headers,
    FormData: globalThis.FormData,
    Response: globalThis.Response,
    TextDecoder: globalThis.TextDecoder,
};

const mod = await import('../src/index.js');

afterAll(() => {
    Object.assign(globalThis, original);
});

describe('global install with the Http module linked', () => {
    it('replaces the host fetch stack with the sigx one', () => {
        expect(globalThis.fetch).toBe(mod.fetch);
        expect(globalThis.Headers).toBe(mod.Headers);
        expect(globalThis.FormData).toBe(mod.FormData);
        expect(globalThis.Response).toBe(mod.Response);
        // Node had real implementations before — they were truly replaced.
        expect(globalThis.fetch).not.toBe(original.fetch);
        expect(globalThis.FormData).not.toBe(original.FormData);
    });

    it('keeps the host TextDecoder (shim only fills a gap)', () => {
        expect(globalThis.TextDecoder).toBe(original.TextDecoder);
    });
});
