/** Web location shim — routes through the sigx.* host bridge. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Location } from '../src/location.web';

let calls: Array<{ name: string; data: unknown }>;
const FIX = {
  latitude: 59.33,
  longitude: 18.06,
  altitude: null,
  accuracy: 12,
  speed: null,
  heading: null,
  timestamp: 1_770_000_000_000,
};

beforeEach(() => {
  calls = [];
  vi.stubGlobal('NativeModules', {
    bridge: {
      call: (name: string, data: unknown, cb: (r: unknown) => void) => {
        calls.push({ name, data });
        cb({
          ok: true,
          value: name === 'sigx.location.getCurrent' ? FIX : { status: 'granted', canAskAgain: true },
        });
      },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('Location (web)', () => {
  it('getCurrentPosition forwards options and resolves the host fix', async () => {
    await expect(Location.getCurrentPosition({ accuracy: 'high', timeout: 5000 })).resolves.toEqual(
      FIX,
    );
    expect(calls[0]).toEqual({
      name: 'sigx.location.getCurrent',
      data: { accuracy: 'high', timeout: 5000 },
    });
  });

  it('permission methods route to the host', async () => {
    await expect(Location.requestPermission()).resolves.toEqual({
      status: 'granted',
      canAskAgain: true,
    });
    await expect(Location.getPermissionStatus()).resolves.toMatchObject({ status: 'granted' });
    expect(calls.map((c) => c.name)).toEqual([
      'sigx.location.requestPermission',
      'sigx.location.permissionStatus',
    ]);
    expect(Location.isAvailable()).toBe(true);
  });
});
