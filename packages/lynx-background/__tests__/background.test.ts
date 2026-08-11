/**
 * Unit tests for the JS-side background API. Mocks `@sigx/lynx-core` and
 * stubs `lynx.getJSModule('GlobalEventEmitter')` so we drive the native fire
 * event in-process. Real `BGTaskScheduler` / `WorkManager` round-trip is
 * exercised on-device.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = {
    callAsync: vi.fn(async (..._args: unknown[]) => undefined as unknown),
    guardModule: vi.fn(),
    isModuleAvailable: vi.fn(() => true),
};

vi.mock('@sigx/lynx-core', async () => ({
    callAsync: (...args: unknown[]) => bridge.callAsync(...(args as [])),
    guardModule: (...args: unknown[]) => bridge.guardModule(...(args as [])),
    isModuleAvailable: (...args: unknown[]) => bridge.isModuleAvailable(...(args as [])),
    // Only the native bridge is faked. `subscribeNative` is the REAL C7
    // implementation (imported from source to skip the barrel), so the
    // payload guard and disposer semantics under test are the shipped ones.
    subscribeNative: (await import('../../lynx-core/src/events.js')).subscribeNative,
    // Likewise real: a faked `unwrapNative` would make the C4 tests below
    // assert on the fake's behaviour rather than on this package's unwrapping.
    unwrapNative: (await import('../../lynx-core/src/errors.js')).unwrapNative,
    unwrapNativeVoid: (await import('../../lynx-core/src/errors.js')).unwrapNativeVoid,
}));

const { isSigxError } = await import('../../lynx-core/src/errors.js');

type Listener = (...a: unknown[]) => void;
const emitter = {
    listeners: new Map<string, Set<Listener>>(),
    addListener(name: string, fn: Listener) {
        if (!this.listeners.has(name)) this.listeners.set(name, new Set());
        this.listeners.get(name)!.add(fn);
    },
    removeListener(name: string, fn: Listener) {
        this.listeners.get(name)?.delete(fn);
    },
    fire(name: string, ...args: unknown[]) {
        for (const fn of this.listeners.get(name) ?? []) fn(...args);
    },
};

(globalThis as unknown as { lynx: unknown }).lynx = {
    getJSModule: (name: string) =>
        name === 'GlobalEventEmitter' ? emitter : undefined,
};

const { Background, __resetForTests } = await import('../src/background.js');

const FIRE = '__sigxBackgroundFire';

beforeEach(() => {
    bridge.callAsync.mockClear();
    bridge.callAsync.mockImplementation(async () => undefined);
    bridge.isModuleAvailable.mockReturnValue(true);
});

afterEach(() => {
    __resetForTests();
    emitter.listeners.clear();
});

// Microtask drain — handler dispatch is async even when the handler body is
// synchronous (we `await handler()` so the `then` lands a tick later).
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('Background.register', () => {
    it('forwards taskName + options to the native bridge', async () => {
        await Background.register('refresh-feed', { minimumInterval: 900, requiresNetwork: true });
        expect(bridge.callAsync).toHaveBeenCalledWith(
            'Background',
            'register',
            'refresh-feed',
            { minimumInterval: 900, requiresNetwork: true },
        );
    });

    it('passes an empty options object when none provided', async () => {
        await Background.register('sync-outbox');
        expect(bridge.callAsync).toHaveBeenCalledWith(
            'Background',
            'register',
            'sync-outbox',
            {},
        );
    });
});

describe('Background.unregister', () => {
    it('forwards taskName to the native bridge', async () => {
        await Background.unregister('refresh-feed');
        expect(bridge.callAsync).toHaveBeenCalledWith(
            'Background',
            'unregister',
            'refresh-feed',
        );
    });
});

describe('Background.getRegistered', () => {
    it('returns the native-provided identifier list', async () => {
        bridge.callAsync.mockResolvedValueOnce(['refresh-feed', 'sync-outbox']);
        const ids = await Background.getRegistered();
        expect(ids).toEqual(['refresh-feed', 'sync-outbox']);
        expect(bridge.callAsync).toHaveBeenCalledWith('Background', 'getRegistered');
    });
});

// C4: `callAsync` rejects only when the *synchronous* hop into the bridge
// throws. Every native-side failure here arrives on the resolved callback as
// `{ error }` — an iOS submit refused for a missing
// `BGTaskSchedulerPermittedIdentifiers` entry, an Android WorkManager
// exception — and used to resolve as a successful `Promise<void>`, so the
// most common setup mistake in this package looked like a clean registration
// and the task simply never fired.
describe('native { error } envelopes reject (C4)', () => {
    it('register rejects with the C10 message and native_error code', async () => {
        bridge.callAsync.mockResolvedValueOnce({
            error: 'BGTaskScheduler.submit failed: identifier not permitted',
        });

        const err = await Background.register('refresh-feed').then(
            () => undefined,
            (e: unknown) => e,
        );

        expect(isSigxError(err)).toBe(true);
        expect(err).toMatchObject({ code: 'native_error', package: 'lynx-background' });
        expect((err as Error).message).toBe(
            '[@sigx/lynx-background] register failed: BGTaskScheduler.submit failed: identifier not permitted',
        );
    });

    it('unregister rejects on { error }', async () => {
        bridge.callAsync.mockResolvedValueOnce({ error: 'WorkManager not initialized' });

        await expect(Background.unregister('refresh-feed')).rejects.toThrow(
            '[@sigx/lynx-background] unregister failed: WorkManager not initialized',
        );
    });

    it('getRegistered rejects on { error } instead of handing back a non-iterable', async () => {
        bridge.callAsync.mockResolvedValueOnce({ error: 'prefs unreadable' });

        await expect(Background.getRegistered()).rejects.toThrow(
            '[@sigx/lynx-background] getRegistered failed: prefs unreadable',
        );
    });
});

// The other half of C4/C5: only `{ error }` is a failure. The ack shapes both
// platforms send on the ordinary paths must keep resolving — a task that was
// never registered is a successful unregister, not an error.
describe('native ack envelopes still resolve', () => {
    it('register resolves on { ok: true }', async () => {
        bridge.callAsync.mockResolvedValueOnce({ ok: true });
        await expect(Background.register('refresh-feed')).resolves.toBeUndefined();
    });

    it('unregister resolves on { ok: false } — nothing was registered', async () => {
        bridge.callAsync.mockResolvedValueOnce({ ok: false });
        await expect(Background.unregister('never-registered')).resolves.toBeUndefined();
    });
});

describe('Background.isAvailable', () => {
    it('delegates to lynx-core', () => {
        bridge.isModuleAvailable.mockReturnValueOnce(false);
        expect(Background.isAvailable()).toBe(false);
        expect(bridge.isModuleAvailable).toHaveBeenCalledWith('Background');
    });
});

describe('Background.setHandler dispatch', () => {
    it('runs the JS handler when the native bus fires and completes success=true', async () => {
        const seen: string[] = [];
        Background.setHandler('refresh-feed', async () => {
            seen.push('ran');
        });
        // Force the dispatcher subscription to be created.
        Background.setHandler('refresh-feed', async () => { seen.push('ran'); });

        emitter.fire(FIRE, { taskName: 'refresh-feed', runId: 'r1' });
        await flush();
        await flush();

        expect(seen).toEqual(['ran']);
        expect(bridge.callAsync).toHaveBeenCalledWith(
            'Background', 'completeTask', 'r1', true,
        );
    });

    it('completes success=false when the handler throws', async () => {
        Background.setHandler('refresh-feed', async () => {
            throw new Error('boom');
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        emitter.fire(FIRE, { taskName: 'refresh-feed', runId: 'r2' });
        await flush();
        await flush();

        expect(bridge.callAsync).toHaveBeenCalledWith(
            'Background', 'completeTask', 'r2', false,
        );
        warn.mockRestore();
    });

    it('logs — rather than silently dropping — a completeTask that fails native-side', async () => {
        bridge.callAsync.mockImplementation(async (...args: unknown[]) =>
            args[1] === 'completeTask' ? { error: 'no in-flight run' } : undefined,
        );
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const handler = vi.fn(async () => {});
        Background.setHandler('refresh-feed', handler);

        emitter.fire(FIRE, { taskName: 'refresh-feed', runId: 'r9' });
        await flush();
        await flush();

        // The wake itself still succeeded — the failure is reported, not
        // rethrown at the OS-driven dispatcher, which has nobody to reject to.
        expect(handler).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
            '[background] completeTask(r9) failed:',
            expect.objectContaining({
                code: 'native_error',
                message: '[@sigx/lynx-background] completeTask failed: no in-flight run',
            }),
        );
        warn.mockRestore();
    });

    it('completes success=false when no handler is registered', async () => {
        // Subscribe to *some* task so the dispatcher is wired, then fire for
        // an unrelated taskName.
        Background.setHandler('other', async () => {});

        emitter.fire(FIRE, { taskName: 'unknown-task', runId: 'r3' });
        await flush();
        await flush();

        expect(bridge.callAsync).toHaveBeenCalledWith(
            'Background', 'completeTask', 'r3', false,
        );
    });

    it('unsubscribe stops further dispatches for that task', async () => {
        const seen: string[] = [];
        const unsub = Background.setHandler('refresh-feed', async () => {
            seen.push('ran');
        });

        emitter.fire(FIRE, { taskName: 'refresh-feed', runId: 'r4' });
        await flush();
        await flush();

        unsub();

        emitter.fire(FIRE, { taskName: 'refresh-feed', runId: 'r5' });
        await flush();
        await flush();

        // First fire ran the handler; second fire had no handler and
        // completed as success=false.
        expect(seen).toEqual(['ran']);
        expect(bridge.callAsync).toHaveBeenCalledWith(
            'Background', 'completeTask', 'r4', true,
        );
        expect(bridge.callAsync).toHaveBeenCalledWith(
            'Background', 'completeTask', 'r5', false,
        );
    });

    it('unsubscribe does not clobber a later setHandler for the same task', async () => {
        const first = vi.fn(async () => {});
        const second = vi.fn(async () => {});

        const unsubFirst = Background.setHandler('refresh-feed', first);
        Background.setHandler('refresh-feed', second);
        // The "old" unsubscribe should be a no-op now that `second` is the
        // active handler — calling it must NOT clear `second`.
        unsubFirst();

        emitter.fire(FIRE, { taskName: 'refresh-feed', runId: 'r6' });
        await flush();
        await flush();

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('a spent unsubscribe does not clear a re-registration of the SAME handler', async () => {
        // The identity guard alone is not enough. A handler reference is
        // usually stable across a remount (module-level function, or a
        // `useCallback` with no deps), so after
        //   mount → unsub → remount(same fn) → stale/duplicate cleanup
        // the guard sees its own function in the map and deletes a live
        // registration belonging to the *second* mount. Every subsequent OS
        // fire then completes success=false with no error anywhere.
        const handler = vi.fn(async () => {});

        const unsubFirst = Background.setHandler('refresh-feed', handler);
        unsubFirst(); // unmount
        Background.setHandler('refresh-feed', handler); // remount, same reference
        unsubFirst(); // duplicate cleanup — must be a no-op

        emitter.fire(FIRE, { taskName: 'refresh-feed', runId: 'r7' });
        await flush();
        await flush();

        expect(handler).toHaveBeenCalledTimes(1);
        expect(bridge.callAsync).toHaveBeenCalledWith(
            'Background', 'completeTask', 'r7', true,
        );
    });

    it('unsubscribe is idempotent — calling it twice in a row is a no-op', async () => {
        const handler = vi.fn(async () => {});
        const unsub = Background.setHandler('refresh-feed', handler);
        expect(() => {
            unsub();
            unsub();
        }).not.toThrow();

        emitter.fire(FIRE, { taskName: 'refresh-feed', runId: 'r8' });
        await flush();
        await flush();

        expect(handler).not.toHaveBeenCalled();
    });
});

describe('events shim resilience', () => {
    it('ignores fire events with malformed payloads', async () => {
        const handler = vi.fn(async () => {});
        Background.setHandler('refresh-feed', handler);

        // Missing runId → dropped by the shim.
        emitter.fire(FIRE, { taskName: 'refresh-feed' });
        // Missing taskName → dropped.
        emitter.fire(FIRE, { runId: 'r7' });
        // Non-object → dropped.
        emitter.fire(FIRE, 42);
        await flush();
        await flush();

        expect(handler).not.toHaveBeenCalled();
    });

    it('parses string-encoded payloads', async () => {
        const handler = vi.fn(async () => {});
        Background.setHandler('refresh-feed', handler);

        emitter.fire(FIRE, JSON.stringify({ taskName: 'refresh-feed', runId: 'r8' }));
        await flush();
        await flush();

        expect(handler).toHaveBeenCalledTimes(1);
        expect(bridge.callAsync).toHaveBeenCalledWith(
            'Background', 'completeTask', 'r8', true,
        );
    });
});
