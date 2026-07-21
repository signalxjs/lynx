/**
 * `webHostCall` — worker-side caller of the sigx host-page bridge
 * (`NativeModules.bridge.call` → `<lynx-view>.onNativeModulesCall`).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { webHostCall, isWebHostAvailable } from '../src/web-host';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubBridge(respond: (name: string, data: unknown) => unknown): void {
  vi.stubGlobal('NativeModules', {
    bridge: {
      call: (name: string, data: unknown, cb: (res: unknown) => void) => {
        cb(respond(name, data));
      },
    },
  });
}

describe('webHostCall', () => {
  it('rejects descriptively when the bridge is absent', async () => {
    expect(isWebHostAvailable()).toBe(false);
    await expect(webHostCall('clipboard.getString')).rejects.toThrow(/bridge is not available/);
  });

  it('prefixes sigx. and resolves an {ok:true} response value', async () => {
    let seen: { name?: string; data?: unknown } = {};
    stubBridge((name, data) => {
      seen = { name, data };
      return { ok: true, value: 'hello' };
    });
    await expect(webHostCall<string>('clipboard.getString', { a: 1 })).resolves.toBe('hello');
    expect(seen.name).toBe('sigx.clipboard.getString');
    expect(seen.data).toEqual({ a: 1 });
    expect(isWebHostAvailable()).toBe(true);
  });

  it('rejects with the host error message on {ok:false}', async () => {
    stubBridge(() => ({ ok: false, error: 'scheme "file:" cannot be opened' }));
    await expect(webHostCall('linking.openURL')).rejects.toThrow(/scheme "file:"/);
  });

  it('rejects with an install hint when the host has no sigx handler', async () => {
    stubBridge(() => undefined); // web-core resolves undefined when unhandled
    await expect(webHostCall('share.share')).rejects.toThrow(/installSigxWebHost/);
  });
});
