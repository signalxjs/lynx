/**
 * Web websocket shim (`websocket.web.ts`) — the Worker-global WHATWG
 * WebSocket re-exported under the package's public names. The module captures
 * the global at import time (matching how the web bundle evaluates once in
 * the Worker), so the test installs a fake global before importing.
 */
import { describe, it, expect, vi } from 'vitest';

class FakeHostWebSocket {
  static CONNECTING = 0;
}

vi.stubGlobal('WebSocket', FakeHostWebSocket);

const { WebSocket, isWebSocketAvailable } = await import('../src/websocket.web');

describe('WebSocket (web)', () => {
  it('re-exports the host WebSocket by identity', () => {
    expect(WebSocket).toBe(FakeHostWebSocket);
  });

  it('isWebSocketAvailable reflects the captured host constructor', () => {
    expect(isWebSocketAvailable()).toBe(true);
  });
});
