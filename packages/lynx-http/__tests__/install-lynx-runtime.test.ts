/**
 * Regression for #373: on the Lynx 0.5.0 runtime the `Http` module may not be
 * enumerable on `NativeModules` at import time AND the engine ships its own
 * global `fetch` (whose `Response` lacks WHATWG `headers`). The install must
 * still replace the global with `sigxFetch` — keyed on RUNTIME PRESENCE, not
 * the import-time `isHttpAvailable()` check — because `sigxFetch` resolves the
 * `Http` module lazily at call time and is strictly better than the engine's.
 *
 * Separate file so the import-time side effect is isolated from install.test.ts.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@sigx/lynx-core', () => ({
    callAsync: vi.fn(async () => undefined),
    guardModule: vi.fn(),
    isModuleAvailable: vi.fn(() => false), // Http NOT enumerable at import time
    base64ToArrayBuffer: (b64: string) => {
        const buf = Buffer.from(b64, 'base64');
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
    arrayBufferToBase64: (buf: ArrayBuffer) => Buffer.from(buf).toString('base64'),
    createLogger: () => ({ trace() {}, debug() {}, info() {}, warn() {}, error() {}, enabled: () => false }),
}));

const G = globalThis as unknown as Record<string, unknown>;
const hadNativeModules = 'NativeModules' in G;
const original = {
    fetch: globalThis.fetch,
    Headers: globalThis.Headers,
    FormData: globalThis.FormData,
    Response: globalThis.Response,
    TextDecoder: globalThis.TextDecoder,
    NativeModules: G['NativeModules'],
};

// Simulate the Lynx runtime: `NativeModules` injected, plus a pre-existing
// engine-provided global `fetch` (non-WHATWG).
const engineFetch = (() => undefined) as unknown as typeof fetch;
G['NativeModules'] = {};
globalThis.fetch = engineFetch;

const mod = await import('../src/index.js');

afterAll(() => {
    Object.assign(globalThis, {
        fetch: original.fetch,
        Headers: original.Headers,
        FormData: original.FormData,
        Response: original.Response,
        TextDecoder: original.TextDecoder,
    });
    if (hadNativeModules) G['NativeModules'] = original.NativeModules;
    else delete G['NativeModules'];
});

describe('#373 — global install on the Lynx runtime when Http is not yet enumerable', () => {
    it('replaces the engine fetch with sigxFetch (runtime-keyed, not import-time module check)', () => {
        expect(globalThis.fetch).toBe(mod.fetch);
        expect(globalThis.fetch).not.toBe(engineFetch);
        expect(globalThis.Response).toBe(mod.Response);
    });
});
