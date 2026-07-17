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
