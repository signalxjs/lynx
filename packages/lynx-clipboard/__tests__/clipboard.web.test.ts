/** Web clipboard shim — routes through the sigx.* host bridge. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Clipboard } from '../src/clipboard.web';

let calls: Array<{ name: string; data: unknown }>;

beforeEach(() => {
  calls = [];
  vi.stubGlobal('NativeModules', {
    bridge: {
      call: (name: string, data: unknown, cb: (r: unknown) => void) => {
        calls.push({ name, data });
        cb(
          name === 'sigx.clipboard.getString'
            ? { ok: true, value: 'from-host' }
            : name === 'sigx.clipboard.hasString'
              ? { ok: true, value: true }
              : { ok: true },
        );
      },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('Clipboard (web)', () => {
  it('setString fire-and-forgets the RPC with the native sync-void shape', () => {
    expect(Clipboard.setString('copy me')).toBeUndefined();
    expect(calls).toEqual([{ name: 'sigx.clipboard.setString', data: { value: 'copy me' } }]);
  });

  it('getString / hasString resolve host values', async () => {
    await expect(Clipboard.getString()).resolves.toBe('from-host');
    await expect(Clipboard.hasString()).resolves.toBe(true);
    expect(Clipboard.isAvailable()).toBe(true);
  });
});
