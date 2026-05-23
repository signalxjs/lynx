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

vi.mock('@sigx/lynx-core', () => ({
    callAsync: (...args: unknown[]) => bridge.callAsync(...(args as [])),
    guardModule: (...args: unknown[]) => bridge.guardModule(...(args as [])),
    isModuleAvailable: (...args: unknown[]) => bridge.isModuleAvailable(...(args as [])),
}));

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
