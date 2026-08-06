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
  it('setString resolves once the host confirms the write', async () => {
    await expect(Clipboard.setString('copy me')).resolves.toBeUndefined();
    expect(calls).toEqual([{ name: 'sigx.clipboard.setString', data: { value: 'copy me' } }]);
  });

  it('setString rejects when the host refuses — a denied permission is real', async () => {
    vi.stubGlobal('NativeModules', {
      bridge: {
        call: (_n: string, _d: unknown, cb: (r: unknown) => void) =>
          cb({ ok: false, error: 'NotAllowedError: write permission denied' }),
      },
    });
    await expect(Clipboard.setString('x')).rejects.toThrow(/permission denied/);
  });

  it('getString / hasString resolve host values', async () => {
    await expect(Clipboard.getString()).resolves.toBe('from-host');
    await expect(Clipboard.hasString()).resolves.toBe(true);
    expect(Clipboard.isAvailable()).toBe(true);
  });
});
