/** Web haptics shim — best-effort vibrate through the host bridge, never throws. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Haptics } from '../src/haptics.web';

let calls: Array<{ name: string; data: unknown }>;

beforeEach(() => {
  calls = [];
});

afterEach(() => vi.unstubAllGlobals());

describe('Haptics (web)', () => {
  it('routes feedback methods to sigx.haptics.vibrate patterns', () => {
    vi.stubGlobal('NativeModules', {
      bridge: {
        call: (name: string, data: unknown, cb: (r: unknown) => void) => {
          calls.push({ name, data });
          cb({ ok: true });
        },
      },
    });
    Haptics.impact('heavy');
    Haptics.notification('error');
    Haptics.selection();
    expect(calls.map((c) => c.name)).toEqual([
      'sigx.haptics.vibrate',
      'sigx.haptics.vibrate',
      'sigx.haptics.vibrate',
    ]);
    expect((calls[0]!.data as { pattern: number }).pattern).toBe(25);
  });

  it('never throws — even with no bridge at all', () => {
    expect(() => {
      Haptics.impact();
      Haptics.notification();
      Haptics.selection();
    }).not.toThrow();
    expect(Haptics.isAvailable()).toBe(false); // degraded approximation by design
  });

  it('diagnose resolves a placeholder without touching the bridge', async () => {
    await expect(Haptics.diagnose()).resolves.toEqual({ hasVibrator: false });
  });
});
