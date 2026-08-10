import { describe, it, expect, vi, afterEach } from 'vitest';
import { addNativeUpdatesListener, __EVENT_CHANNEL_FOR_TESTS } from '../src/events';

type Handler = (...a: unknown[]) => void;

interface EmitterOptions {
    /**
     * Model a host whose `removeListener` rejects a handler it does not hold.
     * This is not a hypothetical: it is exactly why `subscribeNative`'s
     * disposer latches (see the C7 docblock in
     * `packages/lynx-core/src/events.ts` — "removeListener on an
     * already-removed handler is not guaranteed to be harmless on every
     * host") and it is the assumption `lynx-core`'s own suite tests against.
     * It is also the only host model under which a non-idempotent disposer is
     * observably different from an idempotent one, so it is what makes the
     * double-dispose tests below discriminating rather than decorative.
     */
    strictRemove?: boolean;
}

/**
 * Stand-in for Lynx's GlobalEventEmitter. Backed by an **array**, matching the
 * reference implementation in `@lynx-js/react`'s testing env (push on add,
 * filter-by-identity on remove) — a `Set` would paper over duplicate
 * registrations that the real host keeps apart.
 */
function stubEmitter(options: EmitterOptions = {}) {
    const handlers = new Map<string, Handler[]>();
    const emitter = {
        addListener: (name: string, fn: Handler) => {
            handlers.set(name, [...(handlers.get(name) ?? []), fn]);
        },
        removeListener: (name: string, fn: Handler) => {
            const current = handlers.get(name) ?? [];
            if (options.strictRemove && !current.includes(fn)) {
                throw new Error('removeListener: handler is not registered');
            }
            handlers.set(name, current.filter((h) => h !== fn));
        },
    };
    vi.stubGlobal('lynx', { getJSModule: (name: string) => name === 'GlobalEventEmitter' ? emitter : undefined });
    return {
        fire: (payload: unknown) => {
            for (const fn of [...(handlers.get(__EVENT_CHANNEL_FOR_TESTS) ?? [])]) fn(payload);
        },
        /** Live registration count for this channel. */
        count: () => handlers.get(__EVENT_CHANNEL_FOR_TESTS)?.length ?? 0,
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('native updates event channel', () => {
    it('delivers progress events (object payloads)', () => {
        const bus = stubEmitter();
        const events: unknown[] = [];
        addNativeUpdatesListener((e) => events.push(e));

        bus.fire({ kind: 'progress', receivedBytes: 1024, totalBytes: 4096 });
        expect(events).toEqual([{ kind: 'progress', receivedBytes: 1024, totalBytes: 4096 }]);
    });

    it('delivers progress events (JSON string payloads) and nullifies missing totals', () => {
        const bus = stubEmitter();
        const events: Array<{ kind: string; totalBytes?: number | null }> = [];
        addNativeUpdatesListener((e) => events.push(e));

        bus.fire(JSON.stringify({ kind: 'progress', receivedBytes: 10 }));
        expect(events[0]).toEqual({ kind: 'progress', receivedBytes: 10, totalBytes: null });
    });

    it('normalises a negative total to null rather than a bogus denominator', () => {
        // Native reports -1 for "content length unknown"; a percentage built
        // from it renders as a negative bar.
        const bus = stubEmitter();
        const events: unknown[] = [];
        addNativeUpdatesListener((e) => events.push(e));

        bus.fire({ kind: 'progress', receivedBytes: 10, totalBytes: -1 });
        expect(events[0]).toEqual({ kind: 'progress', receivedBytes: 10, totalBytes: null });
    });

    it('delivers foreground events and ignores malformed payloads', () => {
        const bus = stubEmitter();
        const events: Array<{ kind: string }> = [];
        addNativeUpdatesListener((e) => events.push(e));

        bus.fire({ kind: 'foreground' });
        bus.fire({ kind: 'progress' });          // missing receivedBytes
        bus.fire({ kind: 'progress', receivedBytes: 'lots' }); // wrong type
        bus.fire('not json {');
        bus.fire(42);
        bus.fire(null);
        bus.fire({ kind: 'somethingNewer' });
        expect(events).toEqual([{ kind: 'foreground' }]);
    });

    it('contains a throwing listener instead of taking the channel down', () => {
        const bus = stubEmitter();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const seen: unknown[] = [];
        addNativeUpdatesListener(() => { throw new Error('consumer bug'); });
        addNativeUpdatesListener((e) => seen.push(e));

        expect(() => bus.fire({ kind: 'foreground' })).not.toThrow();
        expect(seen).toEqual([{ kind: 'foreground' }]);
    });

    it('unsubscribe removes the wrapped handler', () => {
        const bus = stubEmitter();
        const unsubscribe = addNativeUpdatesListener(() => {});
        expect(bus.count()).toBe(1);
        unsubscribe();
        expect(bus.count()).toBe(0);
    });

    it('disposing twice leaves a second subscriber receiving events (C7)', () => {
        // The lynx-audio failure mode: an ordinary double effect-cleanup
        // (unmount plus an explicit teardown) must not reach past its own
        // registration and silence somebody else's.
        const bus = stubEmitter({ strictRemove: true });
        const a: unknown[] = [];
        const b: unknown[] = [];
        const offA = addNativeUpdatesListener((e) => a.push(e));
        addNativeUpdatesListener((e) => b.push(e));
        expect(bus.count()).toBe(2);

        offA();
        expect(() => offA()).not.toThrow();
        expect(bus.count()).toBe(1);

        bus.fire({ kind: 'foreground' });
        expect(a).toEqual([]);
        expect(b).toEqual([{ kind: 'foreground' }]);
    });

    it('a stale disposer does not unsubscribe a later re-subscription', () => {
        const bus = stubEmitter({ strictRemove: true });
        const events: unknown[] = [];
        const offFirst = addNativeUpdatesListener(() => {});
        offFirst();

        addNativeUpdatesListener((e) => events.push(e));
        offFirst();                       // stale — must not touch the new one
        expect(bus.count()).toBe(1);

        bus.fire({ kind: 'foreground' });
        expect(events).toEqual([{ kind: 'foreground' }]);
    });

    it('returns a no-op unsubscribe without a lynx bridge (web/tests)', () => {
        vi.stubGlobal('lynx', undefined);
        const unsubscribe = addNativeUpdatesListener(() => {});
        expect(() => unsubscribe()).not.toThrow();
        expect(() => unsubscribe()).not.toThrow();
    });
});
