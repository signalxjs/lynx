/**
 * `@sigx/lynx-http` — WHATWG `fetch` for sigx-lynx.
 *
 * The Lynx BG runtime ships no `fetch`/XHR at all; this package provides
 * the HTTP transport (URLSession on iOS, OkHttp on Android) behind a
 * fetch-shaped API, completing the web-platform networking split:
 *
 *   @sigx/lynx-http      ≈ fetch
 *   @sigx/lynx-websocket ≈ WebSocket
 *   @sigx/lynx-network   ≈ navigator.onLine (status only)
 *
 * Importing this module installs `fetch`, `Headers`, `FormData`,
 * `Response`, and a minimal `TextDecoder` on `globalThis` when absent, so
 * portable web code works unchanged. The umbrella `@sigx/lynx` imports it
 * for its side effect — every app gets `fetch` without an explicit import.
 */
import { fetch as sigxFetch, isHttpAvailable } from './fetch.js';
import { Headers as SigxHeaders } from './headers.js';
import { FormData as SigxFormData } from './form-data.js';
import { Response as SigxResponse } from './response.js';
import { SigxTextDecoder } from './codec.js';

export { fetch, isHttpAvailable } from './fetch.js';
export type { RequestInitLike, BodyInitLike, AbortSignalLike } from './fetch.js';
export { Headers } from './headers.js';
export type { HeadersInitLike } from './headers.js';
export { FormData, isFileHandle } from './form-data.js';
export type { FileHandleLike, FormDataEntryValueLike } from './form-data.js';
export { Response, BodyStream } from './response.js';
export { SigxTextDecoder as TextDecoder };
export type {
    NativeRequestSpec,
    NativeBody,
    NativeMultipartPart,
    NativeHttpEvent,
} from './types.js';

// The Lynx native runtime injects `NativeModules` / `lynx` before the bundle
// runs; this is true even when the `Http` module isn't yet enumerable on
// `NativeModules` at import time (it resolves by the time a request fires).
declare const NativeModules: Record<string, unknown> | undefined;
declare const lynx: unknown | undefined;

// Side-effect: register on the global so consumers don't need an import
// site to call `fetch(...)`.
//
// Three cases:
//  1. `Http` linked at import → REPLACE the engine stack outright (some Lynx
//     runtimes ship a built-in fetch whose `Response` lacks WHATWG `headers`/
//     streaming and can't serialize our `FormData`).
//  2. On the Lynx runtime but `Http` not enumerable yet (Lynx 0.5.0 populates
//     `NativeModules` lazily) — install a LAZY fetch that, per call, prefers
//     `sigxFetch` once `Http` resolves, else delegates to whatever fetch the
//     engine provided. This fixes the import-time race AND doesn't break an
//     intentional `excludeModules` opt-out (Http never resolves → engine fetch
//     keeps working). Other globals only fill genuine gaps.
//  3. Off-Lynx host (web, Node/vitest) → only fill gaps so the host's real
//     fetch/Headers/etc. stay intact.
{
    const g = globalThis as unknown as Record<string, unknown>;
    const onLynxRuntime = typeof NativeModules !== 'undefined' || typeof lynx !== 'undefined';
    if (isHttpAvailable()) {
        g.fetch = sigxFetch;
        g.Headers = SigxHeaders;
        g.FormData = SigxFormData;
        g.Response = SigxResponse;
    } else if (onLynxRuntime) {
        const engineFetch = typeof g.fetch === 'function' ? (g.fetch as typeof sigxFetch) : undefined;
        const lazyFetch: typeof sigxFetch = (input, init) =>
            (isHttpAvailable() || !engineFetch ? sigxFetch : engineFetch)(input, init);
        g.fetch = lazyFetch;
        if (typeof g.Headers === 'undefined') g.Headers = SigxHeaders;
        if (typeof g.FormData === 'undefined') g.FormData = SigxFormData;
        if (typeof g.Response === 'undefined') g.Response = SigxResponse;
    } else {
        if (typeof g.fetch === 'undefined') g.fetch = sigxFetch;
        if (typeof g.Headers === 'undefined') g.Headers = SigxHeaders;
        if (typeof g.FormData === 'undefined') g.FormData = SigxFormData;
        if (typeof g.Response === 'undefined') g.Response = SigxResponse;
    }
    if (typeof g.TextDecoder === 'undefined') g.TextDecoder = SigxTextDecoder;
}
