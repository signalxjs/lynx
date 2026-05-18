/**
 * `@sigx/lynx-websocket` — browser-standard `WebSocket` for sigx-lynx.
 *
 * Importing this module (or listing `@sigx/lynx-websocket` in
 * `sigx.lynx.config.ts → modules:`) installs a global `WebSocket` class on
 * `globalThis`, so portable web code that does `new WebSocket(url)` works
 * unchanged.
 */
import { WebSocket as SigxWebSocket } from './websocket';

export { WebSocket, isWebSocketAvailable } from './websocket';

// Side-effect: register on the global so consumers don't need an import
// site to call `new WebSocket(...)`. Mirrors the CLI plugin's auto-import
// behavior for native modules — listing the package in `modules: [...]`
// already causes this file to run at bundle init time.
{
    const g = globalThis as unknown as { WebSocket?: unknown };
    if (typeof g.WebSocket === 'undefined') {
        g.WebSocket = SigxWebSocket;
    }
}
