/**
 * subscribeNative — the edge cases the sixteen hand-rolled copies each had to
 * get right independently. These are the reason the helper exists, so they are
 * the tests that matter.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Minimal stand-in for Lynx's GlobalEventEmitter, counting registrations. */
function fakeEmitter() {
    const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
    return {
        listeners,
        count(channel: string) {
            return listeners.get(channel)?.size ?? 0;
        },
        emit(channel: string, payload: unknown) {
            for (const fn of [...(listeners.get(channel) ?? [])]) fn(payload);
        },
        addListener(name: string, fn: (...a: unknown[]) => void) {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name)!.add(fn);
        },
        removeListener(name: string, fn: (...a: unknown[]) => void) {
            listeners.get(name)?.delete(fn);
        },
    };
}

type Fake = ReturnType<typeof fakeEmitter>;

/** Install a `lynx` global exposing `emitter` as the GlobalEventEmitter. */
function installLynx(emitter: Fake | undefined, opts: { throwOnGet?: boolean } = {}) {
    (globalThis as Record<string, unknown>)['lynx'] = {
        getJSModule(name: string) {
            if (opts.throwOnGet) throw new Error('host is half-initialised');
            return name === 'GlobalEventEmitter' ? emitter : undefined;
        },
    };
}

async function loadSubscribeNative() {
    // Re-import per test so the module never caches a stale emitter lookup.
    vi.resetModules();
    return (await import('../src/events.js')).subscribeNative;
}

const CHANNEL = '__sigxTest';

let emitter: Fake;

beforeEach(() => {
    emitter = fakeEmitter();
    installLynx(emitter);
});

afterEach(() => {
    delete (globalThis as Record<string, unknown>)['lynx'];
    vi.restoreAllMocks();
});

describe('subscribeNative', () => {
    it('delivers object payloads', async () => {
        const subscribeNative = await loadSubscribeNative();
        const cb = vi.fn();
        subscribeNative(CHANNEL, cb);

        emitter.emit(CHANNEL, { taskName: 'sync', runId: 'r1' });

        expect(cb).toHaveBeenCalledWith({ taskName: 'sync', runId: 'r1' });
    });

    it('delivers payloads that arrive as a JSON string', async () => {
        // The native bridge sends either shape depending on the path (#342);
        // every hand-rolled copy had to branch on this.
        const subscribeNative = await loadSubscribeNative();
        const cb = vi.fn();
        subscribeNative(CHANNEL, cb);

        emitter.emit(CHANNEL, JSON.stringify({ taskName: 'sync', runId: 'r1' }));

        expect(cb).toHaveBeenCalledWith({ taskName: 'sync', runId: 'r1' });
    });

    it('drops a string payload that is not JSON rather than delivering garbage', async () => {
        const subscribeNative = await loadSubscribeNative();
        const cb = vi.fn();
        subscribeNative(CHANNEL, cb);

        emitter.emit(CHANNEL, 'not json {');

        expect(cb).not.toHaveBeenCalled();
    });

    it('drops payloads that fail the guard', async () => {
        const subscribeNative = await loadSubscribeNative();
        const cb = vi.fn();
        const isFire = (raw: unknown): raw is { taskName: string } =>
            typeof (raw as { taskName?: unknown })?.taskName === 'string';
        subscribeNative(CHANNEL, cb, { validate: isFire });

        emitter.emit(CHANNEL, { runId: 'r1' });
        expect(cb).not.toHaveBeenCalled();

        emitter.emit(CHANNEL, { taskName: 'sync' });
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('unsubscribes — the disposer actually removes the listener', async () => {
        const subscribeNative = await loadSubscribeNative();
        const cb = vi.fn();
        const off = subscribeNative(CHANNEL, cb);
        expect(emitter.count(CHANNEL)).toBe(1);

        off();

        expect(emitter.count(CHANNEL)).toBe(0);
        emitter.emit(CHANNEL, { a: 1 });
        expect(cb).not.toHaveBeenCalled();
    });

    it('is a no-op on double unsubscribe, and does not disturb other subscribers', async () => {
        // An effect cleanup can fire twice; C7 requires this to be harmless.
        const subscribeNative = await loadSubscribeNative();
        const first = vi.fn();
        const second = vi.fn();
        const off = subscribeNative(CHANNEL, first);
        subscribeNative(CHANNEL, second);

        off();
        expect(() => off()).not.toThrow();

        expect(emitter.count(CHANNEL)).toBe(1);
        emitter.emit(CHANNEL, { a: 1 });
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('contains a throwing listener instead of taking down its siblings', async () => {
        const subscribeNative = await loadSubscribeNative();
        const boom = vi.fn(() => {
            throw new Error('listener bug');
        });
        const ok = vi.fn();
        subscribeNative(CHANNEL, boom);
        subscribeNative(CHANNEL, ok);

        expect(() => emitter.emit(CHANNEL, { a: 1 })).not.toThrow();

        expect(ok).toHaveBeenCalledTimes(1);
    });

    it('reports a throwing listener through the logger, not console (C10)', async () => {
        // Asserting on the transport rather than console.warn is the point:
        // C10 requires module diagnostics to reach the leveled/namespaced
        // pipeline so they surface in the `sigx dev` dashboard.
        vi.resetModules();
        const { subscribeNative } = await import('../src/events.js');
        const { addTransport, clearTransports, setLogLevel } = await import('../src/logger.js');

        const records: { namespace: string; msg: string }[] = [];
        clearTransports();
        setLogLevel('trace');
        addTransport((r) => records.push({ namespace: r.namespace, msg: r.msg }));

        subscribeNative(CHANNEL, () => {
            throw new Error('listener bug');
        }, { namespace: 'lynx-background' });
        emitter.emit(CHANNEL, { a: 1 });

        clearTransports();

        expect(records).toHaveLength(1);
        // The record lands on the CALLER's namespace, not core's — that is what
        // the `namespace` option promises ("routes through the same logger the
        // rest of the package uses"), and it used to only decorate the message
        // while the record stayed on `core:events`, so a package filtering its
        // own logs never saw its own subscription diagnostics.
        expect(records[0]!.namespace).toBe('lynx-background');
        expect(records[0]!.msg).toContain(CHANNEL);
    });

    it('keeps both listeners on one channel independent', async () => {
        const subscribeNative = await loadSubscribeNative();
        const a = vi.fn();
        const b = vi.fn();
        const offA = subscribeNative(CHANNEL, a);
        subscribeNative(CHANNEL, b);

        offA();
        emitter.emit(CHANNEL, { a: 1 });

        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledTimes(1);
    });

    it('is a safe no-op off-device, so packages can subscribe unconditionally', async () => {
        delete (globalThis as Record<string, unknown>)['lynx'];
        const subscribeNative = await loadSubscribeNative();
        const cb = vi.fn();

        const off = subscribeNative(CHANNEL, cb);

        expect(off).toBeTypeOf('function');
        expect(() => off()).not.toThrow();
        expect(cb).not.toHaveBeenCalled();
    });

    it('is a safe no-op when the host has no GlobalEventEmitter', async () => {
        installLynx(undefined);
        const subscribeNative = await loadSubscribeNative();

        expect(() => subscribeNative(CHANNEL, vi.fn())()).not.toThrow();
    });

    it('is a safe no-op when getJSModule itself throws', async () => {
        installLynx(emitter, { throwOnGet: true });
        const subscribeNative = await loadSubscribeNative();

        expect(() => subscribeNative(CHANNEL, vi.fn())()).not.toThrow();
    });

    it('reports emitter availability for the lazy-latch pattern', async () => {
        // Modules that wire on their first API call latch only on success, so
        // they need this: the off-device disposer is a no-op indistinguishable
        // from a real one, and re-deriving `getJSModule` to find out is the
        // duplication this module exists to end.
        vi.resetModules();
        const { isNativeEventsAvailable } = await import('../src/events.js');
        expect(isNativeEventsAvailable()).toBe(true);

        installLynx(undefined);
        expect(isNativeEventsAvailable()).toBe(false);

        installLynx(emitter, { throwOnGet: true });
        expect(isNativeEventsAvailable()).toBe(false);

        delete (globalThis as Record<string, unknown>)['lynx'];
        expect(isNativeEventsAvailable()).toBe(false);

        // Resolved per call, so a module that retries after runtime init wins.
        installLynx(emitter);
        expect(isNativeEventsAvailable()).toBe(true);
    });

    it('survives a host whose removeListener throws', async () => {
        const subscribeNative = await loadSubscribeNative();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const off = subscribeNative(CHANNEL, vi.fn());
        emitter.removeListener = () => {
            throw new Error('host teardown bug');
        };

        expect(() => off()).not.toThrow();
    });
});
