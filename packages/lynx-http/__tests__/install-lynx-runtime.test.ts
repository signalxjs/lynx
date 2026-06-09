/**
 * Regression for #373: on the Lynx 0.5.0 runtime the `Http` module may not be
 * enumerable on `NativeModules` at import time AND the engine ships its own
 * global `fetch` (whose `Response` lacks WHATWG `headers`). The install must
 * hand the global to a LAZY fetch that prefers `sigxFetch` once `Http`
 * resolves, but delegates to the engine fetch until then (and forever, if the
 * module is intentionally excluded — don't break a working engine fetch).
 *
 * Separate file so the import-time side effect is isolated from install.test.ts.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

// Toggled by the tests; the lazy fetch re-checks it on every call.
const h = vi.hoisted(() => ({ httpReady: false }));

vi.mock('@sigx/lynx-core', () => ({
    callAsync: vi.fn(async () => undefined),
    guardModule: vi.fn(),
    isModuleAvailable: vi.fn(() => h.httpReady), // not enumerable at import; flips later
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
const engineFetch = vi.fn(async () => undefined as unknown);
G['NativeModules'] = {};
globalThis.fetch = engineFetch as unknown as typeof fetch;

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

describe('#373 — lazy global fetch on the Lynx runtime', () => {
    it('installs a wrapper (not the engine fetch, not sigxFetch directly)', () => {
        expect(globalThis.fetch).not.toBe(engineFetch);
        expect(globalThis.fetch).not.toBe(mod.fetch);
    });

    it('delegates to the engine fetch while Http is unavailable', () => {
        h.httpReady = false;
        engineFetch.mockClear();
        void (globalThis.fetch as typeof fetch)('https://x.test');
        expect(engineFetch).toHaveBeenCalledTimes(1);
    });

    it('uses sigxFetch once Http resolves (no longer hits the engine fetch)', () => {
        h.httpReady = true;
        engineFetch.mockClear();
        void (globalThis.fetch as typeof fetch)('https://x.test').catch(() => undefined);
        expect(engineFetch).not.toHaveBeenCalled();
    });
});
