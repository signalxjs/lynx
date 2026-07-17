/** Web notifications shim — local via the host bridge; push degrades cleanly. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Notifications } from '../src/notifications.web';

let calls: Array<{ name: string; data: unknown }>;

beforeEach(() => {
  calls = [];
  vi.stubGlobal('NativeModules', {
    bridge: {
      call: (name: string, data: unknown, cb: (r: unknown) => void) => {
        calls.push({ name, data });
        cb({
          ok: true,
          value:
            name === 'sigx.notifications.schedule'
              ? 'web-1'
              : name === 'sigx.notifications.getBadge'
                ? 3
                : name === 'sigx.notifications.setBadge'
                  ? undefined // Promise<void> surface
                  : name.endsWith('Permission') || name.endsWith('permissionStatus')
                    ? { status: 'granted', canAskAgain: true }
                    : true,
        });
      },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('Notifications (web)', () => {
  it('schedule forwards content + options and resolves the host id', async () => {
    await expect(
      Notifications.schedule(
        { title: 'Hi', body: 'There', data: { k: 'v' } },
        { delay: 5, repeat: 'day' },
      ),
    ).resolves.toBe('web-1');
    expect(calls[0]).toEqual({
      name: 'sigx.notifications.schedule',
      data: { title: 'Hi', body: 'There', data: { k: 'v' }, delay: 5, repeat: 'day' },
    });
  });

  it('cancel / badges / permissions route through the bridge', async () => {
    await expect(Notifications.cancel('web-1')).resolves.toBe(true);
    await expect(Notifications.cancelAll()).resolves.toBe(true);
    await expect(Notifications.setBadgeCount(3)).resolves.toBeUndefined(); // Promise<void>: resolves, no throw
    await expect(Notifications.getBadgeCount()).resolves.toBe(3);
    await expect(Notifications.requestPermission()).resolves.toMatchObject({ status: 'granted' });
    expect(calls.map((c) => c.name)).toEqual([
      'sigx.notifications.cancel',
      'sigx.notifications.cancelAll',
      'sigx.notifications.setBadge',
      'sigx.notifications.getBadge',
      'sigx.notifications.requestPermission',
    ]);
  });

  it('push registration degrades via the error field without touching the bridge', async () => {
    const reg = await Notifications.registerForPushNotifications();
    expect(reg.error).toContain('not supported on web');
    const unreg = await Notifications.unregisterForPushNotifications();
    expect(unreg).toMatchObject({ ok: false });
    await expect(Notifications.getInitialNotification()).resolves.toBeNull();
    expect(calls).toEqual([]); // none of these hit the bridge
  });
});
