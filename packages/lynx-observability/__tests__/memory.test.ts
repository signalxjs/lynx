/**
 * `Memory.query()` — the path that ships on iOS and Android.
 *
 * Drives the real `@sigx/lynx-core` bridge against a faked `NativeModules`
 * global, so the module name, the method name and the callback convention are
 * exercised rather than mocked away.
 *
 * The normalization cases are not padding: the values here end up in log
 * records and remote dashboards, so a `NaN` or a stray `-1` propagates a lot
 * further than a bad return value normally would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Memory } from '../src/memory';

/** Records what crossed the bridge, so call shape is asserted, not assumed. */
let calls: Array<{ method: string; args: unknown[] }>;
/** What the fake native module resolves. Reassign per test. */
let nativeResult: unknown;

function installNativeModules(linked = true) {
    vi.stubGlobal('NativeModules', linked
        ? {
            Observability: {
                queryMemoryUsage: (...args: never[]) => {
                    const cb = args[args.length - 1] as unknown as (r: unknown) => void;
                    calls.push({ method: 'queryMemoryUsage', args: args.slice(0, -1) });
                    cb(nativeResult);
                },
            },
        }
        : {});
}

/** A fully-populated engine result, as the native side serializes it. */
const COMPLETE = {
    collectionStatus: 'completed',
    collectionStartMs: 1_700_000_000_000,
    collectionDurationMs: 12,
    collectionTimeoutMs: 2000,
    expectedInstanceCount: 1,
    completedInstanceCount: 1,
    totalBytes: 12_000_000,
    appBytes: 90_000_000,
    ratioToApp: 0.1333,
    elementBytes: 4_000_000,
    elementNodeCount: 1234,
    viewBytes: 2_000_000,
    mainThreadRuntimeBytes: 3_000_000,
    backgroundThreadRuntimeBytes: 3_000_000,
    instances: [{
        instanceId: 0,
        pageId: 'page-0',
        url: 'http://localhost:3000/main.lynx.bundle',
        totalBytes: 12_000_000,
        elementBytes: 4_000_000,
        elementNodeCount: 1234,
        viewBytes: 2_000_000,
        mainThreadRuntimeBytes: 3_000_000,
        backgroundThreadRuntimeBytes: 3_000_000,
        btsRuntimeGroupId: 'group-a',
    }],
};

beforeEach(() => {
    calls = [];
    nativeResult = COMPLETE;
    installNativeModules();
});

afterEach(() => vi.unstubAllGlobals());

describe('the bridge call', () => {
    it('reaches the Observability module by its literal method name', async () => {
        // `check:manifests` matches this name textually against
        // signalx-module.json's ios.methods — if the call site changes, the
        // manifest has to change with it (C12).
        await Memory.query();
        expect(calls).toEqual([{ method: 'queryMemoryUsage', args: [{}] }]);
    });

    it('always passes an options object', async () => {
        // The Swift selector arity is fixed at (params, callback); omitting the
        // dictionary would shift the callback into the params slot.
        await Memory.query();
        expect(calls[0]?.args).toHaveLength(1);
        expect(calls[0]?.args[0]).toEqual({});
    });

    it('forwards timeoutMs when given', async () => {
        await Memory.query({ timeoutMs: 50 });
        expect(calls[0]?.args[0]).toEqual({ timeoutMs: 50 });
    });
});

describe('the resolved snapshot', () => {
    it('passes a complete result through unchanged', async () => {
        await expect(Memory.query()).resolves.toEqual(COMPLETE);
    });

    it('treats a timeout as a partial result, not an error', async () => {
        // The single most misreadable case: every aggregate is a partial sum,
        // and the caller — not this layer — decides whether to act on it.
        nativeResult = { ...COMPLETE, collectionStatus: 'timeout', expectedInstanceCount: 3 };
        const snapshot = await Memory.query({ timeoutMs: 1 });
        expect(snapshot.collectionStatus).toBe('timeout');
        expect(snapshot.completedInstanceCount).toBeLessThan(snapshot.expectedInstanceCount);
    });

    it('reports an unattached instance as null rather than -1', async () => {
        nativeResult = { ...COMPLETE, instances: [{ ...COMPLETE.instances[0], instanceId: -1 }] };
        const snapshot = await Memory.query();
        expect(snapshot.instances[0]?.instanceId).toBeNull();
    });

    it('keeps a real instance id', async () => {
        nativeResult = { ...COMPLETE, instances: [{ ...COMPLETE.instances[0], instanceId: 7 }] };
        const snapshot = await Memory.query();
        expect(snapshot.instances[0]?.instanceId).toBe(7);
    });

    it('parses a payload that arrives as a JSON string', async () => {
        // Native payload shapes have drifted to strings before (#342).
        nativeResult = JSON.stringify(COMPLETE);
        await expect(Memory.query()).resolves.toEqual(COMPLETE);
    });

    it('defaults missing numbers to zero rather than NaN', async () => {
        nativeResult = { collectionStatus: 'completed' };
        const snapshot = await Memory.query();
        expect(snapshot.totalBytes).toBe(0);
        expect(snapshot.ratioToApp).toBe(0);
        expect(snapshot.elementNodeCount).toBe(0);
        expect(Number.isNaN(snapshot.appBytes)).toBe(false);
    });

    it('drops a non-finite number rather than propagating it', async () => {
        nativeResult = { ...COMPLETE, totalBytes: Number.NaN, appBytes: Number.POSITIVE_INFINITY };
        const snapshot = await Memory.query();
        expect(snapshot.totalBytes).toBe(0);
        expect(snapshot.appBytes).toBe(0);
    });

    it('falls back to "unknown" for a status the engine adds later', async () => {
        nativeResult = { ...COMPLETE, collectionStatus: 'cancelled' };
        await expect(Memory.query()).resolves.toMatchObject({ collectionStatus: 'unknown' });
    });

    it('yields an empty instances array when the field is absent or malformed', async () => {
        nativeResult = { collectionStatus: 'completed', instances: 'nope' };
        await expect(Memory.query()).resolves.toMatchObject({ instances: [] });
    });

    it('skips a malformed instance row instead of failing the whole reading', async () => {
        nativeResult = { ...COMPLETE, instances: [null, COMPLETE.instances[0], 42] };
        const snapshot = await Memory.query();
        expect(snapshot.instances).toHaveLength(1);
        expect(snapshot.instances[0]?.pageId).toBe('page-0');
    });
});

describe('failures', () => {
    it('throws a prefixed SigxError on the native error envelope (C4/C10)', async () => {
        nativeResult = { error: 'collector unavailable' };
        await expect(Memory.query()).rejects.toThrow(
            '[@sigx/lynx-observability] queryMemoryUsage failed: collector unavailable',
        );
    });

    it('throws when the native module is not linked (C3)', async () => {
        installNativeModules(false);
        await expect(Memory.query()).rejects.toThrow(/Observability/);
    });
});

describe('isAvailable', () => {
    it('is true when the module is linked and false when it is not', () => {
        expect(Memory.isAvailable()).toBe(true);
        installNativeModules(false);
        expect(Memory.isAvailable()).toBe(false);
    });
});
