/**
 * Web network shim (`network.web.ts`) — `navigator.onLine` +
 * `navigator.connection.type` mapping.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { Network } from '../src/network.web';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Network (web)', () => {
  it('online with a known connection type', async () => {
    vi.stubGlobal('navigator', { onLine: true, connection: { type: 'wifi' } });
    await expect(Network.getState()).resolves.toEqual({
      isConnected: true,
      type: 'wifi',
      isInternetReachable: true,
    });
  });

  it('offline reports type none regardless of connection info', async () => {
    vi.stubGlobal('navigator', { onLine: false, connection: { type: 'wifi' } });
    await expect(Network.getState()).resolves.toEqual({
      isConnected: false,
      type: 'none',
      isInternetReachable: false,
    });
  });

  it('unknown / missing connection info maps to unknown', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    await expect(Network.getState()).resolves.toMatchObject({ type: 'unknown' });
    vi.stubGlobal('navigator', { onLine: true, connection: { type: 'wimax' } });
    await expect(Network.getState()).resolves.toMatchObject({ type: 'unknown' });
  });

  it('absent onLine assumes connected; isAvailable tracks navigator presence', async () => {
    vi.stubGlobal('navigator', {});
    await expect(Network.getState()).resolves.toMatchObject({ isConnected: true });
    expect(Network.isAvailable()).toBe(true);
  });
});
