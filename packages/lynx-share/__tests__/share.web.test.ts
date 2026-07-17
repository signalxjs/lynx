/** Web share shim — fire-and-forget through the sigx.* host bridge. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Share } from '../src/share.web';

let calls: Array<{ name: string; data: unknown }>;
let respond: (r: unknown) => unknown;

beforeEach(() => {
  calls = [];
  respond = () => ({ ok: true });
  vi.stubGlobal('NativeModules', {
    bridge: {
      call: (name: string, data: unknown, cb: (r: unknown) => void) => {
        calls.push({ name, data });
        cb(respond(name));
      },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('Share (web)', () => {
  it('share fire-and-forgets the full options payload', () => {
    expect(Share.share({ title: 'T', message: 'M', url: 'https://x' })).toBeUndefined();
    expect(calls).toEqual([
      { name: 'sigx.share.share', data: { title: 'T', message: 'M', url: 'https://x' } },
    ]);
    expect(Share.isAvailable()).toBe(true);
  });

  it('a host failure is contained (never throws out of the sync call)', async () => {
    respond = () => ({ ok: false, error: 'navigator.share is not supported' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Share.share({ title: 'T' });
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
