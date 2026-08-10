/**
 * `<AppearanceProvider>`'s native subscription — the C7 contract.
 *
 * The provider used to hand-roll its own `GlobalEventEmitter` shim (one of
 * sixteen copies); it now goes through `subscribeNative()` from
 * `@sigx/lynx-core`. These tests pin the behaviours that differ between the
 * two, plus the disposer contract C7 requires.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { component } from '@sigx/lynx';
import { render } from '@sigx/lynx-testing';
import { effect } from '@sigx/reactivity';

import { AppearanceProvider, APPEARANCE_EVENT, subscribeAppearance } from '../src/provider';
import { useSystemColorScheme } from '../src/hooks';
import { GLOBAL_PROPS_KEY } from '../src/globals';
import type { ColorScheme } from '../src/types';

type Handler = (...a: unknown[]) => void;

/**
 * Stand-in for Lynx's `GlobalEventEmitter`, modelled on the real one in two
 * ways that matter here:
 *
 *  - `emit` walks its handlers in a plain loop, so an exception thrown by one
 *    handler aborts the dispatch and the handlers behind it never run. That is
 *    what "a listener must not take the emitter down" (C7) is about.
 *  - `removeListener` rejects a handler it doesn't hold. Hosts differ here and
 *    the tolerant ones hide double-teardown; the strict model is what makes a
 *    non-idempotent disposer visible instead of silent.
 */
function makeEmitter() {
    const listeners = new Map<string, Handler[]>();
    return {
        count(name: string): number {
            return listeners.get(name)?.length ?? 0;
        },
        addListener(name: string, fn: Handler): void {
            const arr = listeners.get(name);
            if (arr) arr.push(fn);
            else listeners.set(name, [fn]);
        },
        removeListener(name: string, fn: Handler): void {
            const arr = listeners.get(name);
            const i = arr ? arr.indexOf(fn) : -1;
            if (!arr || i < 0) throw new Error('removeListener: handler is not registered');
            arr.splice(i, 1);
        },
        emit(name: string, payload: unknown): void {
            // Snapshot: a handler is allowed to unsubscribe itself mid-dispatch.
            const handlers = listeners.get(name)?.slice() ?? [];
            for (const fn of handlers) fn(payload);
        },
    };
}

type Emitter = ReturnType<typeof makeEmitter>;

function installLynx(emitter: Emitter, initial?: ColorScheme): void {
    (globalThis as { lynx?: unknown }).lynx = {
        __globalProps: initial ? { [GLOBAL_PROPS_KEY]: { colorScheme: initial } } : {},
        getJSModule: (name: string) => (name === 'GlobalEventEmitter' ? emitter : undefined),
    };
}

/** Mount the provider with a probe that mirrors the live scheme into `out`. */
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

let emitter: Emitter;

beforeEach(() => {
    emitter = makeEmitter();
});

afterEach(() => {
    delete (globalThis as { lynx?: unknown }).lynx;
    vi.restoreAllMocks();
});

describe('AppearanceProvider subscription lifecycle', () => {
    it('registers exactly one listener on mount and drops it on unmount', () => {
        installLynx(emitter, 'light');
        const { unmount } = renderProvider({ scheme: null });
        expect(emitter.count(APPEARANCE_EVENT)).toBe(1);
        unmount();
        expect(emitter.count(APPEARANCE_EVENT)).toBe(0);
    });

    it('mounts without an emitter present (web preview, SSR, tests)', () => {
        (globalThis as { lynx?: unknown }).lynx = { __globalProps: {} };
        const out = { scheme: null as ColorScheme | null };
        expect(() => renderProvider(out)).not.toThrow();
        expect(out.scheme).toBe('light');
    });

    it('survives a host whose getJSModule throws', () => {
        // A half-initialised host used to take the provider's mount down with
        // it — and the provider sits at the app root, so that is the app.
        (globalThis as { lynx?: unknown }).lynx = {
            __globalProps: {},
            getJSModule() {
                throw new Error('host is half-initialised');
            },
        };
        expect(() => renderProvider({ scheme: null })).not.toThrow();
    });
});

describe('AppearanceProvider payload handling', () => {
    it('publishes a scheme flip to consumers', () => {
        installLynx(emitter, 'light');
        const out = { scheme: null as ColorScheme | null };
        renderProvider(out);
        expect(out.scheme).toBe('light');

        emitter.emit(APPEARANCE_EVENT, { colorScheme: 'dark' });

        expect(out.scheme).toBe('dark');
    });

    it('accepts a payload that arrives as a JSON string', () => {
        // The native bridge delivers either shape depending on the path; the
        // hand-rolled shim only understood the object one, so on a host that
        // stringifies, dark mode simply never arrived.
        installLynx(emitter, 'light');
        const out = { scheme: null as ColorScheme | null };
        renderProvider(out);

        emitter.emit(APPEARANCE_EVENT, JSON.stringify({ colorScheme: 'dark' }));

        expect(out.scheme).toBe('dark');
    });

    it.each([
        ['an unknown scheme', { colorScheme: 'purple' }],
        ['a missing scheme', {}],
        ['a non-object payload', 42],
        ['a null payload', null],
        ['unparseable JSON', '{not json'],
    ])('ignores %s', (_label, payload) => {
        installLynx(emitter, 'light');
        const out = { scheme: null as ColorScheme | null };
        renderProvider(out);

        emitter.emit(APPEARANCE_EVENT, payload);

        expect(out.scheme).toBe('light');
    });
});

describe('C7: a listener must not take the emitter down', () => {
    it('contains a throwing consumer so later listeners on the channel still run', () => {
        // sigx effects flush synchronously, so a consumer that throws on a
        // scheme flip throws *out of* `colorScheme.value = …` — i.e. out of the
        // provider's listener and into the host's dispatch loop, which then
        // abandons every listener queued behind it. One buggy theme consumer
        // used to silently stop appearance updates for the whole app.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        installLynx(emitter, 'light');

        const Boom = component(() => {
            const scheme = useSystemColorScheme();
            effect(() => {
                if (scheme.value === 'dark') throw new Error('consumer boom');
            });
            return () => <view />;
        });
        render(
            <AppearanceProvider>
                <Boom />
            </AppearanceProvider>,
        );

        const bystander = vi.fn();
        emitter.addListener(APPEARANCE_EVENT, bystander);

        expect(() => emitter.emit(APPEARANCE_EVENT, { colorScheme: 'dark' })).not.toThrow();
        expect(bystander).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalled();
    });
});

describe('C7: the disposer is idempotent', () => {
    it('leaves the other subscriber alone when one disposer runs twice', () => {
        // An effect cleanup can fire twice (unmount plus an explicit teardown).
        // In `@sigx/lynx-audio` that second call drove a shared refcount to zero
        // and switched native metering off under a live listener; the guard in
        // `subscribeNative` is what stops the same shape here.
        installLynx(emitter, 'light');
        const a = vi.fn();
        const b = vi.fn();
        const disposeA = subscribeAppearance(a);
        subscribeAppearance(b);
        expect(emitter.count(APPEARANCE_EVENT)).toBe(2);

        disposeA();
        expect(() => disposeA()).not.toThrow();

        expect(emitter.count(APPEARANCE_EVENT)).toBe(1);
        emitter.emit(APPEARANCE_EVENT, { colorScheme: 'dark' });
        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledWith('dark');
    });

    it('returns a plain function, never a { remove() } object (C7)', () => {
        installLynx(emitter, 'light');
        const dispose = subscribeAppearance(() => undefined);
        expect(typeof dispose).toBe('function');
        expect((dispose as unknown as { remove?: unknown }).remove).toBeUndefined();
        dispose();
    });

    it('returns a working no-op disposer when there is no emitter', () => {
        (globalThis as { lynx?: unknown }).lynx = { __globalProps: {} };
        const dispose = subscribeAppearance(() => undefined);
        expect(() => {
            dispose();
            dispose();
        }).not.toThrow();
    });
});
