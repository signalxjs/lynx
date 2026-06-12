import { describe, it, expect, vi, afterEach } from 'vitest';
import { addNativeUpdatesListener, __EVENT_CHANNEL_FOR_TESTS } from '../src/events';

type Handler = (...a: unknown[]) => void;

function stubEmitter() {
    const handlers = new Map<string, Set<Handler>>();
    const emitter = {
        addListener: (name: string, fn: Handler) => {
            if (!handlers.has(name)) handlers.set(name, new Set());
            handlers.get(name)!.add(fn);
        },
        removeListener: (name: string, fn: Handler) => {
            handlers.get(name)?.delete(fn);
        },
    };
    vi.stubGlobal('lynx', { getJSModule: (name: string) => name === 'GlobalEventEmitter' ? emitter : undefined });
    return {
        fire: (payload: unknown) => {
            for (const fn of handlers.get(__EVENT_CHANNEL_FOR_TESTS) ?? []) fn(payload);
        },
        count: () => handlers.get(__EVENT_CHANNEL_FOR_TESTS)?.size ?? 0,
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
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

    it('delivers foreground events and ignores malformed payloads', () => {
        const bus = stubEmitter();
        const events: Array<{ kind: string }> = [];
        addNativeUpdatesListener((e) => events.push(e));

        bus.fire({ kind: 'foreground' });
        bus.fire({ kind: 'progress' });          // missing receivedBytes
        bus.fire('not json {');
        bus.fire(42);
        expect(events).toEqual([{ kind: 'foreground' }]);
    });

    it('unsubscribe removes the wrapped handler', () => {
        const bus = stubEmitter();
        const unsubscribe = addNativeUpdatesListener(() => {});
        expect(bus.count()).toBe(1);
        unsubscribe();
        expect(bus.count()).toBe(0);
    });

    it('returns a no-op unsubscribe without a lynx bridge (web/tests)', () => {
        vi.stubGlobal('lynx', undefined);
        const unsubscribe = addNativeUpdatesListener(() => {});
        expect(() => unsubscribe()).not.toThrow();
    });
});
