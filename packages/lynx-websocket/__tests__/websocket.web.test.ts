/**
 * Web websocket shim (`websocket.web.ts`) — the Worker-global WHATWG
 * WebSocket re-exported under the package's public names. The module captures
 * the global at import time (matching how the web bundle evaluates once in
 * the Worker), so the test installs a fake global before importing.
 */
import { describe, it, expect, vi } from 'vitest';

class FakeHostWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  CONNECTING = 0;
  OPEN = 1;
  CLOSING = 2;
  CLOSED = 3;
}

vi.stubGlobal('WebSocket', FakeHostWebSocket);

const { WebSocket, isWebSocketAvailable } = await import('../src/websocket.web');

describe('WebSocket (web)', () => {
  it('re-exports the host WebSocket by identity', () => {
    expect(WebSocket).toBe(FakeHostWebSocket);
  });

  it('exposes the ready-state constants on class and instance (package contract)', () => {
    // Mirrors the native suite's contract test — a host constructor missing
    // these would be a real parity break, not just a typing mismatch.
    expect(WebSocket.CONNECTING).toBe(0);
    expect(WebSocket.OPEN).toBe(1);
    expect(WebSocket.CLOSING).toBe(2);
    expect(WebSocket.CLOSED).toBe(3);
    const instance = Object.create(WebSocket.prototype) as InstanceType<typeof WebSocket>;
    // WHATWG puts the constants on the interface (class + prototype chain).
    expect(instance.OPEN ?? WebSocket.OPEN).toBe(1);
  });

  it('isWebSocketAvailable reflects the captured host constructor', () => {
    expect(isWebSocketAvailable()).toBe(true);
  });
});
