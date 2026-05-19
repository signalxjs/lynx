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
        const g = globalThis as {
            fetch?: typeof fetch;
            XMLHttpRequest?: { new (): XMLHttpRequest };
            lynx?: { fetch?: (req: { url: string; method?: string; headers?: Record<string, string>; body?: string }) => Promise<unknown> };
        };
        logRaw(`[sigx-dev-client] probe globals: fetch=${typeof g.fetch} XHR=${typeof g.XMLHttpRequest} lynx.fetch=${typeof g.lynx?.fetch}`);
        try {
            if (typeof g.fetch === 'function') {
                Promise.resolve(g.fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                })).then(
                    (res: Response | undefined) => logRaw(`[sigx-dev-client] raw fetch → ${res?.status ?? '?'}`),
                    (err: unknown) => logRaw(`[sigx-dev-client] raw fetch FAILED: ${(err as { message?: string })?.message ?? String(err)}`),
                );
            } else if (typeof g.XMLHttpRequest === 'function') {
                const xhr = new g.XMLHttpRequest();
                xhr.open('POST', url, true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.onreadystatechange = (): void => {
                    if (xhr.readyState === 4) {
                        logRaw(`[sigx-dev-client] raw XHR → ${xhr.status}`);
                    }
                };
                xhr.onerror = (): void => logRaw('[sigx-dev-client] raw XHR errored');
                xhr.send(body);
            } else if (typeof g.lynx?.fetch === 'function') {
                Promise.resolve(g.lynx.fetch({
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
