/**
 * `getColorScheme()` — the JS side of the manifest's `getColorScheme` method,
 * and the provider's cold-start recovery that uses it.
 *
 * The native method existed on both platforms and nothing in JS ever called
 * it (C12: the manifest has to be true). It is kept rather than deleted
 * because it answers a question `readGlobalColorScheme()` cannot: what the OS
 * reports *now*, when nothing published `lynx.__globalProps.appearance` — or
 * when the BG thread's snapshot of it is stale after an in-place flip (#990).
 *
 * These drive the real `@sigx/lynx-core` bridge against a faked
 * `NativeModules` global, so the module name, the callback shape and the
 * `{ error }` unwrap are exercised rather than mocked away.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { component } from '@sigx/lynx';
import { render } from '@sigx/lynx-testing';
import { effect } from '@sigx/reactivity';

import { getColorScheme, isAvailable } from '../src/setters';
import { AppearanceProvider } from '../src/provider';
import { useSystemColorScheme } from '../src/hooks';
import { GLOBAL_PROPS_KEY } from '../src/globals';
import type { ColorScheme } from '../src/types';

type Reply = Record<string, unknown>;

/** Calls that crossed the bridge — call shape is asserted, not assumed. */
let calls: string[];

/** Install a fake `Appearance` native module whose getter replies `reply`. */
function installNative(reply: Reply | undefined): void {
    calls = [];
    vi.stubGlobal('NativeModules', {
        Appearance: {
            getColorScheme: (cb: (r: Reply | undefined) => void) => {
                calls.push('getColorScheme');
                cb(reply);
            },
        },
    });
}

/** Unlink the module: `NativeModules` exists, `Appearance` does not. */
function installUnlinked(): void {
    calls = [];
    vi.stubGlobal('NativeModules', {});
}

/** Minimal Lynx global; `initial` seeds `__globalProps.appearance`. */
function installLynx(initial?: ColorScheme): void {
    (globalThis as { lynx?: unknown }).lynx = {
        __globalProps: initial ? { [GLOBAL_PROPS_KEY]: { colorScheme: initial } } : {},
        getJSModule: () => undefined,
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { lynx?: unknown }).lynx;
    vi.restoreAllMocks();
});

describe('getColorScheme', () => {
    beforeEach(() => installLynx());

    it.each<[ColorScheme]>([['dark'], ['light']])('resolves the native %s reply', async (scheme) => {
        installNative({ colorScheme: scheme });
        await expect(getColorScheme()).resolves.toBe(scheme);
        expect(calls).toEqual(['getColorScheme']);
    });

    it('resolves null without touching the bridge when the module is unlinked', async () => {
        // C3 opt-out, documented in the JSDoc and the README: "unknown", the
        // same answer `readGlobalColorScheme()` gives, so a themed root renders
        // identically off-device.
        installUnlinked();
        expect(isAvailable()).toBe(false);
        await expect(getColorScheme()).resolves.toBeNull();
        expect(calls).toEqual([]);
    });

    it.each([
        ['an unknown scheme', { colorScheme: 'purple' }],
        ['a missing scheme', {}],
        ['no payload at all', undefined],
    ])('resolves null for %s rather than inventing light', async (_label, reply) => {
        installNative(reply as Reply | undefined);
        await expect(getColorScheme()).resolves.toBeNull();
    });

    it('throws the scoped message on a native failure (C4/C10)', async () => {
        // A bridge/native failure is not "unknown scheme" — it surfaces as a
        // SigxError carrying the package, the action and the native cause.
        installNative({ error: 'no active window scene' });
        await expect(getColorScheme()).rejects.toThrow(
            '[@sigx/lynx-appearance] getColorScheme failed: no active window scene',
        );
    });
});

describe('AppearanceProvider cold-start recovery', () => {
    /** Mount the provider with a probe mirroring the live scheme into `out`. */
    function renderProvider(out: { scheme: ColorScheme | null }) {
        const Probe = component(() => {
            const scheme = useSystemColorScheme();
            effect(() => {
                out.scheme = scheme.value as ColorScheme;
            });
            return () => <view />;
        });
        return render(
            <AppearanceProvider>
                <Probe />
            </AppearanceProvider>,
        );
    }

    it('asks native when nothing published globalProps, and corrects the seed', async () => {
        // The publisher isn't wired (or hasn't run): the sync read is null and
        // consumers used to sit on the 'light' seed until the *user* flipped
        // the system setting — on a dark device, indefinitely.
        installLynx();
        installNative({ colorScheme: 'dark' });
        const out = { scheme: null as ColorScheme | null };
        renderProvider(out);
        expect(out.scheme).toBe('light');

        await vi.waitFor(() => expect(out.scheme).toBe('dark'));
        expect(calls).toEqual(['getColorScheme']);
    });

    it('does not ask native when globalProps already answered', async () => {
        installLynx('dark');
        installNative({ colorScheme: 'light' });
        const out = { scheme: null as ColorScheme | null };
        renderProvider(out);

        expect(out.scheme).toBe('dark');
        await Promise.resolve();
        expect(calls).toEqual([]);
    });

    it('keeps the seed when the native read fails, and logs instead of throwing', async () => {
        // The provider sits at the app root: a rejected probe must not take the
        // mount down, and the diagnostic goes through createLogger (C10), whose
        // default transport writes to the console.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        installLynx();
        installNative({ error: 'boom' });
        const out = { scheme: null as ColorScheme | null };

        expect(() => renderProvider(out)).not.toThrow();
        await vi.waitFor(() => expect(warn).toHaveBeenCalled());
        expect(out.scheme).toBe('light');
    });

    it('lets a live event outrank a slower native reply', async () => {
        // Ordering matters: the event stream is the truth, the probe is a
        // fallback. A reply that lands after a flip must not undo it.
        let reply: ((r: Reply) => void) | undefined;
        calls = [];
        const listeners: Array<(p: unknown) => void> = [];
        vi.stubGlobal('NativeModules', {
            Appearance: {
                getColorScheme: (cb: (r: Reply) => void) => {
                    calls.push('getColorScheme');
                    reply = cb;
                },
            },
        });
        (globalThis as { lynx?: unknown }).lynx = {
            __globalProps: {},
            getJSModule: (name: string) =>
                name === 'GlobalEventEmitter'
                    ? {
                          addListener: (_n: string, fn: (p: unknown) => void) => listeners.push(fn),
                          removeListener: () => undefined,
                      }
                    : undefined,
        };

        const out = { scheme: null as ColorScheme | null };
        renderProvider(out);
        for (const fn of listeners) fn({ colorScheme: 'dark' });
        expect(out.scheme).toBe('dark');

        reply?.({ colorScheme: 'light' });
        await Promise.resolve();
        expect(out.scheme).toBe('dark');
    });

    it('ignores a reply that lands after unmount', async () => {
        let reply: ((r: Reply) => void) | undefined;
        calls = [];
        vi.stubGlobal('NativeModules', {
            Appearance: {
                getColorScheme: (cb: (r: Reply) => void) => {
                    calls.push('getColorScheme');
                    reply = cb;
                },
            },
        });
        installLynx();

        const out = { scheme: null as ColorScheme | null };
        const { unmount } = renderProvider(out);
        unmount();

        expect(() => reply?.({ colorScheme: 'dark' })).not.toThrow();
        await Promise.resolve();
        expect(out.scheme).toBe('light');
    });
});
