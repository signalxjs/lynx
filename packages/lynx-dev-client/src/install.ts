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

import { installConsoleStreamer } from './streamer.js';

declare const __SIGX_DEV_LOG_URL__: string | undefined;
// Build identity baked in by `@sigx/lynx-plugin` (same value the dev server
// greets us with). Lets the streamer reload when it reconnects to a server
// serving a different build.
declare const __SIGX_BUILD_ID__: string | undefined;

// On the Lynx BG runtime the whole bundle is wrapped in a single
// `tt.define("background.js", function(..., console, ...) { ... })` factory.
// The bare `console` identifier resolves via scope chain to that parameter,
// which is a DIFFERENT object from `globalThis.console`. We capture it here
// (a bare reference, NOT `globalThis.console`) so the streamer can patch it
// too — otherwise user `console.log(...)` calls compile to that factory-arg
// console and bypass our patches.
const factoryConsole: unknown = typeof console !== 'undefined' ? console : undefined;

try {
    const url = typeof __SIGX_DEV_LOG_URL__ !== 'undefined' ? __SIGX_DEV_LOG_URL__ : undefined;
    if (url) {
        const extraTargets: Array<{
            log: (...a: unknown[]) => void;
            info: (...a: unknown[]) => void;
            warn: (...a: unknown[]) => void;
            error: (...a: unknown[]) => void;
            debug: (...a: unknown[]) => void;
            trace: (...a: unknown[]) => void;
        }> = [];
        if (factoryConsole && typeof factoryConsole === 'object') {
            extraTargets.push(factoryConsole as never);
        }
        const runningBuildId = typeof __SIGX_BUILD_ID__ !== 'undefined' ? __SIGX_BUILD_ID__ : undefined;
        installConsoleStreamer(url, { extraTargets, runningBuildId });
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

