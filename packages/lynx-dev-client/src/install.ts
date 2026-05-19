/**
 * Auto-installed by `@sigx/lynx-plugin` in dev builds.
 *
 * Imported at the very front of the BG entry; reads the dev-server log URL
 * baked in via `source.define` and installs the streamer if it's set.
 *
 * Never import this file directly from app code — it has unconditional side
 * effects and is intended to be tree-shaken out of production builds by the
 * plugin (which simply doesn't prepend it when `NODE_ENV === 'production'`).
 */

import { installConsoleStreamer } from './streamer';

declare const __SIGX_DEV_LOG_URL__: string | undefined;

try {
    // The plugin defines this only in dev. In any other build it's
    // `undefined` and the streamer is a no-op.
    const url = typeof __SIGX_DEV_LOG_URL__ !== 'undefined' ? __SIGX_DEV_LOG_URL__ : undefined;
    // Emit one bootstrap line through the captured original console so the
    // user can verify the install module actually ran inside the BG runtime.
    // (If this never appears in the device logbox/inspector, install.ts was
    // tree-shaken or never executed.)
    try {
        (globalThis as { console?: { log?: (...a: unknown[]) => void } }).console?.log?.(
            `[sigx-dev-client] streamer install: url=${url ?? '(undefined)'} fetch=${typeof (globalThis as { fetch?: unknown }).fetch}`,
        );
    } catch { /* ignore */ }
    // Direct raw POST that bypasses the streamer — proves whether the BG
    // runtime can reach the dev-server endpoint at all. Tries fetch first,
    // then XMLHttpRequest (some Lynx runtimes ship one but not the other).
    if (url) {
        const logRaw = (msg: string): void => {
            try {
                (globalThis as { console?: { log?: (...a: unknown[]) => void } }).console?.log?.(msg);
            } catch { /* ignore */ }
        };
        const body = JSON.stringify({
            entries: [{
                level: 'log',
                args: ['[sigx-dev-client] raw POST probe'],
                ts: Date.now(),
                platform: 'probe',
            }],
        });
        // Lynx documents `fetch()` as a *global identifier* on the BTS runtime
        // (https://lynxjs.org/api/lynx-api/global/fetch.html) and may bind it
        // directly without exposing it on `globalThis`. Resolve through `eval`
        // so the reference doesn't blow up if the identifier is missing.
        const resolveBare = (name: string): unknown => {
            try {
                // eslint-disable-next-line @typescript-eslint/no-implied-eval
                return new Function(`try { return typeof ${name} !== 'undefined' ? ${name} : undefined } catch (_) { return undefined }`)();
            } catch { return undefined; }
        };
        const g = globalThis as {
            fetch?: typeof fetch;
            XMLHttpRequest?: { new (): XMLHttpRequest };
            lynx?: { fetch?: (req: { url: string; method?: string; headers?: Record<string, string>; body?: string }) => Promise<unknown> };
        };
        const bareFetch = resolveBare('fetch') as typeof fetch | undefined;
        const bareXhr = resolveBare('XMLHttpRequest') as { new (): XMLHttpRequest } | undefined;
        const bareLynx = resolveBare('lynx') as { fetch?: (req: { url: string; method?: string; headers?: Record<string, string>; body?: string }) => Promise<unknown> } | undefined;
        const fetchImpl = g.fetch ?? bareFetch;
        const xhrImpl = g.XMLHttpRequest ?? bareXhr;
        const lynxFetch = g.lynx?.fetch ?? bareLynx?.fetch;
        logRaw(`[sigx-dev-client] probe globals: globalThis.fetch=${typeof g.fetch} bare fetch=${typeof bareFetch} XHR=${typeof xhrImpl} lynx.fetch=${typeof lynxFetch}`);
        try {
            if (typeof fetchImpl === 'function') {
                Promise.resolve(fetchImpl(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                })).then(
                    (res: Response | undefined) => logRaw(`[sigx-dev-client] raw fetch → ${res?.status ?? '?'}`),
                    (err: unknown) => logRaw(`[sigx-dev-client] raw fetch FAILED: ${(err as { message?: string })?.message ?? String(err)}`),
                );
            } else if (typeof xhrImpl === 'function') {
                const xhr = new xhrImpl();
                xhr.open('POST', url, true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.onreadystatechange = (): void => {
                    if (xhr.readyState === 4) {
                        logRaw(`[sigx-dev-client] raw XHR → ${xhr.status}`);
                    }
                };
                xhr.onerror = (): void => logRaw('[sigx-dev-client] raw XHR errored');
                xhr.send(body);
            } else if (typeof lynxFetch === 'function') {
                Promise.resolve(lynxFetch({
                    url,
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                })).then(
                    (res: unknown) => logRaw(`[sigx-dev-client] raw lynx.fetch ok: ${JSON.stringify(res).slice(0, 200)}`),
                    (err: unknown) => logRaw(`[sigx-dev-client] raw lynx.fetch FAILED: ${(err as { message?: string })?.message ?? String(err)}`),
                );
            } else {
                logRaw('[sigx-dev-client] no fetch/XHR/lynx.fetch on globalThis — cannot stream');
            }
        } catch (err) {
            logRaw(`[sigx-dev-client] raw probe threw: ${(err as { message?: string })?.message ?? String(err)}`);
        }
    }
    if (url) {
        installConsoleStreamer(url);
        // First post-install log — this goes through the patched console,
        // so it exercises the full POST → middleware → stdout pipeline.
        try {
            (globalThis as { console?: { log?: (...a: unknown[]) => void } }).console?.log?.(
                '[sigx-dev-client] streamer ready',
            );
        } catch { /* ignore */ }
    }
} catch {
    // Never let dev-tooling crash the host app.
}
