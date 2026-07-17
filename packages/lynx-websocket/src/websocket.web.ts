/**
 * Web implementation (runs in `@lynx-js/web-core`'s Worker): the Worker-global
 * WHATWG `WebSocket` IS the implementation — re-exported under the package's
 * public names. The web bundle swaps this file in via the plugin's `.web.js`
 * `extensionAlias` (signalxjs/lynx#697), and the native base64/demux bridge in
 * `websocket.ts` tree-shakes away entirely.
 *
 * Worker scope only — no `window.` / `document.` here. (`__internal` is a
 * test-only escape hatch of the native implementation and has no web
 * counterpart; tests import the native source directly.)
 */

const HostWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;

/**
 * The host's WHATWG `WebSocket` — the exact standard surface the native class
 * emulates, so the cast below is the identity contract of this package.
 */
export const WebSocket = HostWebSocket as typeof import('./websocket.js').WebSocket;

/** Whether a host `WebSocket` exists (true in every browser/Worker). */
export function isWebSocketAvailable(): boolean {
  return typeof HostWebSocket === 'function';
}
