/**
 * Host-page bridge (`installSigxWebHost`) — RPC dispatch + publishers,
 * driven through a fake `<lynx-view>` object and stubbed page globals.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { installSigxWebHost, type LynxViewLike } from '../src/host';

interface FakeMql {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  fire: (matches: boolean) => void;
}

function makeMql(matches: boolean): FakeMql {
  let listener: ((e: { matches: boolean }) => void) | undefined;
  return {
    matches,
    addEventListener: vi.fn((_t: string, fn: (e: { matches: boolean }) => void) => {
      listener = fn;
    }),
    removeEventListener: vi.fn(),
    fire(m: boolean) {
      listener?.({ matches: m });
    },
  };
}

function makeView(): LynxViewLike & {
  updateGlobalProps: ReturnType<typeof vi.fn>;
  sendGlobalEvent: ReturnType<typeof vi.fn>;
} {
  return {
    globalProps: {},
    updateGlobalProps: vi.fn(),
    sendGlobalEvent: vi.fn(),
  } as unknown as LynxViewLike & {
    updateGlobalProps: ReturnType<typeof vi.fn>;
    sendGlobalEvent: ReturnType<typeof vi.fn>;
  };
}

let mql: FakeMql;
let pageListeners: Map<string, Set<() => void>>;
const firePage = (type: string): void => {
  for (const fn of pageListeners.get(type) ?? []) fn();
};

beforeEach(() => {
  mql = makeMql(true);
  pageListeners = new Map();
  vi.stubGlobal('matchMedia', vi.fn(() => mql));
  vi.stubGlobal('location', { href: 'https://app.example/route?x=1' });
  vi.stubGlobal('addEventListener', (t: string, fn: () => void) => {
    if (!pageListeners.has(t)) pageListeners.set(t, new Set());
    pageListeners.get(t)!.add(fn);
  });
  vi.stubGlobal('removeEventListener', (t: string, fn: () => void) => {
    pageListeners.get(t)?.delete(fn);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sigx.* RPC dispatch', () => {
  it('routes clipboard.setString to navigator.clipboard and replies {ok:true}', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => {}) } });
    const view = makeView();
    installSigxWebHost(view);
    const res = await view.onNativeModulesCall!('sigx.clipboard.setString', { value: 'hi' }, 'bridge');
    expect(res).toEqual({ ok: true, value: undefined });
    expect(
      (navigator as unknown as { clipboard: { writeText: ReturnType<typeof vi.fn> } }).clipboard
        .writeText,
    ).toHaveBeenCalledWith('hi');
  });

  it('an unknown sigx handler replies {ok:false} with a message', async () => {
    const view = makeView();
    installSigxWebHost(view);
    const res = (await view.onNativeModulesCall!('sigx.nope.what', {}, 'bridge')) as {
      ok: boolean;
      error: string;
    };
    expect(res.ok).toBe(false);
    expect(res.error).toContain('sigx.nope.what');
  });

  it('a throwing handler replies {ok:false} instead of propagating', async () => {
    const view = makeView();
    installSigxWebHost(view);
    // linking.openURL with a non-openable scheme throws synchronously
    const res = (await view.onNativeModulesCall!(
      'sigx.linking.openURL',
      { url: 'file:///etc/passwd' },
      'bridge',
    )) as { ok: boolean; error: string };
    expect(res.ok).toBe(false);
    expect(res.error).toContain('scheme');
  });

  it('non-sigx calls fall through to a pre-existing handler with `this` = the view', () => {
    const view = makeView();
    let seenThis: unknown;
    view.onNativeModulesCall = function (this: unknown) {
      seenThis = this;
      return 'prev-result';
    };
    installSigxWebHost(view);
    const res = view.onNativeModulesCall!('someOther.thing', { a: 1 }, 'custom');
    expect(res).toBe('prev-result');
    // web-core invokes the handler as a method on <lynx-view>; delegation
    // must preserve that receiver.
    expect(seenThis).toBe(view);
  });

  it('linking.canOpenURL allowlists browser-openable schemes', async () => {
    const view = makeView();
    installSigxWebHost(view);
    // Sync handler → the dispatch returns the response object directly.
    const can = (u: string) => view.onNativeModulesCall!('sigx.linking.canOpenURL', { url: u }, 'bridge');
    expect(can('https://x.example')).toEqual({ ok: true, value: true });
    expect(can('mailto:a@b.c')).toEqual({ ok: true, value: true });
    expect(can('myapp://deep/link')).toEqual({ ok: true, value: false });
  });
});

describe('publishers', () => {
  it('appearance: seeds globalProps and publishes scheme changes', () => {
    const view = makeView();
    installSigxWebHost(view);
    expect((view.globalProps as Record<string, unknown>)['appearance']).toEqual({
      colorScheme: 'dark', // fake mql matches=true
    });
    mql.fire(false); // system flips to light
    expect(view.updateGlobalProps).toHaveBeenCalledWith({ appearance: { colorScheme: 'light' } });
    expect(view.sendGlobalEvent).toHaveBeenCalledWith('appearanceChanged', [
      { colorScheme: 'light' },
    ]);
  });

  it('linking: seeds initialURL and publishes urlReceived on popstate', () => {
    const view = makeView();
    installSigxWebHost(view);
    expect((view.globalProps as Record<string, unknown>)['initialURL']).toBe(
      'https://app.example/route?x=1',
    );
    firePage('popstate');
    expect(view.sendGlobalEvent).toHaveBeenCalledWith('urlReceived', [
      'https://app.example/route?x=1',
    ]);
  });

  it('uninstall removes page listeners', () => {
    const view = makeView();
    const uninstall = installSigxWebHost(view);
    uninstall();
    expect(mql.removeEventListener).toHaveBeenCalled();
    view.sendGlobalEvent.mockClear();
    firePage('popstate');
    expect(view.sendGlobalEvent).not.toHaveBeenCalled();
  });

  it('publishers can be opted out', () => {
    const view = makeView();
    installSigxWebHost(view, { appearance: false, linking: false });
    expect(view.globalProps).toEqual({});
  });
});

describe('sigx.location.* handlers', () => {
  const fakeGeo = (behavior: 'fix' | 'deny') => ({
    getCurrentPosition: (
      ok: (pos: unknown) => void,
      err: (e: { message: string }) => void,
      opts: { enableHighAccuracy?: boolean },
    ) => {
      if (behavior === 'fix') {
        ok({
          coords: {
            latitude: 1,
            longitude: 2,
            altitude: null,
            accuracy: opts.enableHighAccuracy ? 3 : 30,
            speed: null,
            heading: null,
          },
          timestamp: 42,
        });
      } else {
        err({ message: 'User denied Geolocation' });
      }
    },
  });

  it('location.getCurrent maps coords and honors accuracy', async () => {
    vi.stubGlobal('navigator', { geolocation: fakeGeo('fix') });
    const view = makeView();
    installSigxWebHost(view);
    const res = (await view.onNativeModulesCall!(
      'sigx.location.getCurrent',
      { accuracy: 'high' },
      'bridge',
    )) as { ok: boolean; value: { latitude: number; accuracy: number; timestamp: number } };
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({
      latitude: 1,
      longitude: 2,
      altitude: null,
      accuracy: 3, // enableHighAccuracy honored by the fake
      speed: null,
      heading: null,
      timestamp: 42,
    });
  });

  it('location.getCurrent surfaces denial as {ok:false}', async () => {
    vi.stubGlobal('navigator', { geolocation: fakeGeo('deny') });
    const view = makeView();
    installSigxWebHost(view);
    const res = (await view.onNativeModulesCall!('sigx.location.getCurrent', {}, 'bridge')) as {
      ok: boolean;
      error: string;
    };
    expect(res.ok).toBe(false);
    expect(res.error).toContain('denied');
  });

  it('location.permissionStatus maps Permissions API states', async () => {
    for (const [state, status, canAskAgain] of [
      ['granted', 'granted', true],
      ['denied', 'blocked', false],
      ['prompt', 'undetermined', true],
    ] as const) {
      vi.stubGlobal('navigator', {
        permissions: { query: async () => ({ state }) },
      });
      const view = makeView();
      installSigxWebHost(view);
      const res = (await view.onNativeModulesCall!(
        'sigx.location.permissionStatus',
        {},
        'bridge',
      )) as { ok: boolean; value: { status: string; canAskAgain: boolean } };
      expect(res.value).toEqual({ status, canAskAgain });
    }
  });

  it('location.requestPermission prompts via a position request (no Permissions API → granted)', async () => {
    vi.stubGlobal('navigator', { geolocation: fakeGeo('fix') });
    const view = makeView();
    installSigxWebHost(view);
    const res = (await view.onNativeModulesCall!(
      'sigx.location.requestPermission',
      {},
      'bridge',
    )) as { ok: boolean; value: { status: string } };
    expect(res.value.status).toBe('granted');
  });

  it('location.requestPermission trusts a decisive Permissions API answer', async () => {
    vi.stubGlobal('navigator', {
      geolocation: fakeGeo('fix'),
      permissions: { query: async () => ({ state: 'granted' }) },
    });
    const view = makeView();
    installSigxWebHost(view);
    const res = (await view.onNativeModulesCall!(
      'sigx.location.requestPermission',
      {},
      'bridge',
    )) as { ok: boolean; value: { status: string; canAskAgain: boolean } };
    expect(res.value).toEqual({ status: 'granted', canAskAgain: true });
  });

  it('a one-time allow (API still prompt) still reports granted after a successful probe', async () => {
    vi.stubGlobal('navigator', {
      geolocation: fakeGeo('fix'),
      permissions: { query: async () => ({ state: 'prompt' }) },
    });
    const view = makeView();
    installSigxWebHost(view);
    const res = (await view.onNativeModulesCall!(
      'sigx.location.requestPermission',
      {},
      'bridge',
    )) as { ok: boolean; value: { status: string } };
    expect(res.value.status).toBe('granted');
  });
});

describe('sigx.notifications.* handlers', () => {
  class FakeNotification {
    static permission: 'granted' | 'denied' | 'default' = 'granted';
    static instances: FakeNotification[] = [];
    static requestPermission = async () => FakeNotification.permission;
    closed = false;
    constructor(
      public title: string,
      public options?: { body?: string; tag?: string },
    ) {
      FakeNotification.instances.push(this);
    }
    close() {
      this.closed = true;
    }
  }

  beforeEach(() => {
    FakeNotification.permission = 'granted';
    FakeNotification.instances = [];
    vi.stubGlobal('Notification', FakeNotification);
    vi.stubGlobal('navigator', {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const call = (view: ReturnType<typeof makeView>, name: string, data: unknown = {}) =>
    view.onNativeModulesCall!(name, data, 'bridge');

  it('schedule shows after delay, repeats, and cancel closes + stops it', async () => {
    const view = makeView();
    installSigxWebHost(view);
    const res = (await call(view, 'sigx.notifications.schedule', {
      title: 'T',
      body: 'B',
      delay: 2,
      repeat: 'minute',
    })) as { ok: boolean; value: string };
    expect(res.ok).toBe(true);
    expect(FakeNotification.instances).toHaveLength(0);
    vi.advanceTimersByTime(2000);
    expect(FakeNotification.instances).toHaveLength(1);
    expect(FakeNotification.instances[0]).toMatchObject({ title: 'T', options: { body: 'B' } });
    vi.advanceTimersByTime(60_000);
    expect(FakeNotification.instances).toHaveLength(2); // repeated
    const cancelled = (await call(view, 'sigx.notifications.cancel', { id: res.value })) as {
      value: boolean;
    };
    expect(cancelled.value).toBe(true);
    vi.advanceTimersByTime(120_000);
    expect(FakeNotification.instances).toHaveLength(2); // repeat stopped
    expect(FakeNotification.instances.every((n) => n.closed)).toBe(true);
  });

  it('schedule without permission fails descriptively', async () => {
    FakeNotification.permission = 'default';
    const view = makeView();
    installSigxWebHost(view);
    const res = (await call(view, 'sigx.notifications.schedule', { title: 'T', body: 'B' })) as {
      ok: boolean;
      error: string;
    };
    expect(res.ok).toBe(false);
    expect(res.error).toContain('permission');
  });

  it('permission mapping: denied → blocked, default → undetermined', async () => {
    const view = makeView();
    installSigxWebHost(view);
    FakeNotification.permission = 'denied';
    expect(
      ((await call(view, 'sigx.notifications.permissionStatus')) as { value: unknown }).value,
    ).toEqual({ status: 'blocked', canAskAgain: false });
    FakeNotification.permission = 'default';
    expect(
      ((await call(view, 'sigx.notifications.requestPermission')) as { value: unknown }).value,
    ).toEqual({ status: 'undetermined', canAskAgain: true });
  });

  it('badge is tracked locally and clamped', async () => {
    const view = makeView();
    installSigxWebHost(view);
    await call(view, 'sigx.notifications.setBadge', { count: 5 });
    expect(((await call(view, 'sigx.notifications.getBadge')) as { value: number }).value).toBe(5);
    await call(view, 'sigx.notifications.setBadge', { count: -2 });
    expect(((await call(view, 'sigx.notifications.getBadge')) as { value: number }).value).toBe(0);
  });
});
