/**
 * Auto-installed by `@sigx/lynx-plugin` in dev builds.
 *
 * Imported at the very front of the BG entry; reads the dev-server log URL
 * baked in via `source.define` and installs the WebSocket console streamer
 * if it's set.
 *
 * Never import this file directly from app code — it has unconditional side
 * effects and is intended to be tree-shaken out of production builds by the
 * plugin (which simply doesn't prepend it when `NODE_ENV === 'production'`).
 */

// Side-effect: attaches a WHATWG `WebSocket` to `globalThis`. Without this
// import the streamer has no transport on the Lynx BG runtime.
import '@sigx/lynx-websocket';

import { installConsoleStreamer } from './streamer';

declare const __SIGX_DEV_LOG_URL__: string | undefined;

try {
    const url = typeof __SIGX_DEV_LOG_URL__ !== 'undefined' ? __SIGX_DEV_LOG_URL__ : undefined;
    if (url) {
        installConsoleStreamer(url);
        // First post-install log — this goes through the patched console,
        // so it exercises the full WS → server → sentinel → CLI pipeline.
        try {
            (globalThis as { console?: { log?: (...a: unknown[]) => void } }).console?.log?.(
                `[sigx-dev-client] ws streamer ready: ${url}`,
            );
        } catch { /* ignore */ }
    }
} catch {
    // Never let dev-tooling crash the host app.
}
