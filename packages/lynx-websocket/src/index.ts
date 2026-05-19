/**
 * `@sigx/lynx-websocket` — browser-standard `WebSocket` for sigx-lynx.
 *
 * Importing this module (or having `@sigx/lynx-websocket` installed so the
 * CLI auto-discovers it during `sigx prebuild`) installs a global `WebSocket`
 * class on `globalThis`, so portable web code that does `new WebSocket(url)`
 * works unchanged.
 */
import { WebSocket as SigxWebSocket } from './websocket';

export { WebSocket, isWebSocketAvailable } from './websocket';

// Side-effect: register on the global so consumers don't need an import
// site to call `new WebSocket(...)`. Mirrors the CLI plugin's auto-import
// behavior for native modules — the auto-linker picks up the package's
// sigx-module.json and this file runs at bundle init time.
{
    const g = globalThis as unknown as { WebSocket?: unknown };
    if (typeof g.WebSocket === 'undefined') {
        g.WebSocket = SigxWebSocket;
    }
}
