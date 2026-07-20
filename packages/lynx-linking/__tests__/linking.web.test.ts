/** Web linking shim — outbound via the host bridge, inbound via inbound.ts. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Linking } from '../src/linking.web';

let calls: Array<{ name: string; data: unknown }>;

beforeEach(() => {
  calls = [];
  vi.stubGlobal('NativeModules', {
    bridge: {
      call: (name: string, data: unknown, cb: (r: unknown) => void) => {
        calls.push({ name, data });
        cb({ ok: true, value: name.endsWith('canOpenURL') ? true : undefined });
      },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('Linking (web)', () => {
  it('openURL / canOpenURL route through the host bridge', async () => {
    await expect(Linking.openURL('https://sigx.dev')).resolves.toBeUndefined();
    await expect(Linking.canOpenURL('mailto:a@b.c')).resolves.toBe(true);
    expect(calls.map((c) => c.name)).toEqual(['sigx.linking.openURL', 'sigx.linking.canOpenURL']);
    expect(calls[0]!.data).toEqual({ url: 'https://sigx.dev' });
  });

  it('getInitialURL reads __globalProps via the shared inbound reader', () => {
    vi.stubGlobal('lynx', { __globalProps: { initialURL: 'https://app.example/deep' } });
    expect(Linking.getInitialURL()).toBe('https://app.example/deep');
  });

  it('addEventListener subscribes urlReceived on the GlobalEventEmitter', () => {
    const listeners = new Map<string, (raw: unknown) => void>();
    vi.stubGlobal('lynx', {
      getJSModule: () => ({
        addListener: (n: string, fn: (raw: unknown) => void) => listeners.set(n, fn),
        removeListener: (n: string) => listeners.delete(n),
      }),
    });
    const seen: string[] = [];
    const sub = Linking.addEventListener('url', ({ url }) => seen.push(url));
    listeners.get('urlReceived')!('https://app.example/next');
    expect(seen).toEqual(['https://app.example/next']);
    sub.remove();
    expect(listeners.size).toBe(0);
  });
});
