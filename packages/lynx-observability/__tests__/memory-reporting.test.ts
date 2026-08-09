/**
 * `Memory.startReporting()` — the loop that turns readings into log records.
 *
 * Everything is asserted against a transport installed by the test, never
 * against global process state: a reporting loop that leaks past its disposer
 * or swallows a rejection is exactly the kind of thing that shows up as an
 * unrelated flake somewhere else in the suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addTransport, clearTransports, type LogRecord } from '@sigx/lynx-core';

import { Memory } from '../src/memory';

let records: LogRecord[];
/** Resolved by the fake native module, per call. */
let queue: unknown[];
let calls: number;

function installNativeModules(linked = true) {
    vi.stubGlobal('NativeModules', linked
        ? {
            Observability: {
                queryMemoryUsage: (...args: never[]) => {
                    const cb = args[args.length - 1] as unknown as (r: unknown) => void;
                    calls += 1;
                    cb(queue.length > 1 ? queue.shift() : queue[0]);
                },
            },
        }
        : {});
}

const SNAPSHOT = {
    collectionStatus: 'completed',
    completedInstanceCount: 2,
    expectedInstanceCount: 2,
    totalBytes: 10_485_760, // 10 MB
    instances: [
        { instanceId: 0, totalBytes: 6_000_000 },
        { instanceId: 1, totalBytes: 4_000_000 },
        { instanceId: 2, totalBytes: 400_000 },
    ],
};

beforeEach(() => {
    vi.useFakeTimers();
    records = [];
    queue = [SNAPSHOT];
    calls = 0;
    clearTransports();
    addTransport((r) => records.push(r));
    installNativeModules();
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearTransports();
});

const memoryRecords = () => records.filter((r) => r.namespace === 'memory');

describe('the loop', () => {
    it('takes a reading immediately and logs it under the memory namespace', async () => {
        const stop = Memory.startReporting();
        await vi.advanceTimersByTimeAsync(0);
        const [record] = memoryRecords();
        expect(record?.level.name).toBe('info');
        expect(record?.msg).toContain('10.0 MB across 2/2 instance(s)');
        stop();
    });

    it('honours immediate: false by waiting one interval first', async () => {
        const stop = Memory.startReporting({ immediate: false, intervalMs: 1000 });
        await vi.advanceTimersByTimeAsync(0);
        expect(calls).toBe(0);
        await vi.advanceTimersByTimeAsync(1000);
        expect(calls).toBe(1);
        stop();
    });

    it('logs at the configured level', async () => {
        const stop = Memory.startReporting({ level: 'debug' });
        await vi.advanceTimersByTimeAsync(0);
        expect(memoryRecords()[0]?.level.name).toBe('debug');
        stop();
    });

    it('reschedules from completion, so slow queries cannot overlap', async () => {
        // The query resolves on the next microtask; if the loop used
        // setInterval, a query slower than the interval would stack up
        // process-global collections. One in flight at a time, always.
        const stop = Memory.startReporting({ intervalMs: 1000 });
        await vi.advanceTimersByTimeAsync(0);
        expect(calls).toBe(1);
        await vi.advanceTimersByTimeAsync(1000);
        expect(calls).toBe(2);
        await vi.advanceTimersByTimeAsync(1000);
        expect(calls).toBe(3);
        stop();
    });

    it('truncates the instance rows to maxInstances', async () => {
        const stop = Memory.startReporting({ maxInstances: 2 });
        await vi.advanceTimersByTimeAsync(0);
        const fields = memoryRecords()[0]?.fields[0] as { instances: unknown[] };
        expect(fields.instances).toHaveLength(2);
        stop();
    });

    it('omits the rows entirely at maxInstances: 0', async () => {
        const stop = Memory.startReporting({ maxInstances: 0 });
        await vi.advanceTimersByTimeAsync(0);
        const fields = memoryRecords()[0]?.fields[0] as { instances: unknown[] };
        expect(fields.instances).toHaveLength(0);
        stop();
    });

    it('invokes onReading with the full snapshot', async () => {
        const seen: unknown[] = [];
        const stop = Memory.startReporting({ onReading: (s) => seen.push(s) });
        await vi.advanceTimersByTimeAsync(0);
        expect(seen).toHaveLength(1);
        expect((seen[0] as { totalBytes: number }).totalBytes).toBe(10_485_760);
        stop();
    });
});

describe('the disposer', () => {
    it('stops further readings', async () => {
        const stop = Memory.startReporting({ intervalMs: 1000 });
        await vi.advanceTimersByTimeAsync(0);
        expect(calls).toBe(1);
        stop();
        await vi.advanceTimersByTimeAsync(5000);
        expect(calls).toBe(1);
    });

    it('is a no-op when called twice (C7)', async () => {
        const stop = Memory.startReporting({ intervalMs: 1000 });
        await vi.advanceTimersByTimeAsync(0);
        stop();
        expect(() => stop()).not.toThrow();
        await vi.advanceTimersByTimeAsync(5000);
        expect(calls).toBe(1);
    });

    it('suppresses a reading that was already in flight', async () => {
        const stop = Memory.startReporting();
        stop(); // before the first query settles
        await vi.advanceTimersByTimeAsync(0);
        expect(memoryRecords()).toHaveLength(0);
    });
});

describe('failures', () => {
    it('warns on a failed reading and keeps going, with no unhandled rejection', async () => {
        // An unhandled rejection on the background runtime is a fatal
        // main-thread exception under PrimJS (#863), not a console warning —
        // so every tick has to catch. Asserted through the transport rather
        // than by listening on the process.
        queue = [{ error: 'collector unavailable' }, SNAPSHOT];
        const stop = Memory.startReporting({ intervalMs: 1000 });
        await vi.advanceTimersByTimeAsync(0);
        expect(memoryRecords()[0]?.level.name).toBe('warn');
        await vi.advanceTimersByTimeAsync(1000);
        expect(memoryRecords()[1]?.level.name).toBe('info');
        stop();
    });

    it('keeps looping when onReading throws', async () => {
        const stop = Memory.startReporting({
            intervalMs: 1000,
            onReading: () => { throw new Error('consumer blew up'); },
        });
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(1000);
        expect(calls).toBe(2);
        stop();
    });

    it('degrades to a no-op disposer when the module is not linked (documented C3 opt-out)', async () => {
        // startReporting is ambient telemetry started before app code runs, so
        // it must not throw the way query() does.
        installNativeModules(false);
        const stop = Memory.startReporting();
        await vi.advanceTimersByTimeAsync(5000);
        expect(calls).toBe(0);
        expect(memoryRecords().map((r) => r.level.name)).toEqual(['debug']);
        expect(() => stop()).not.toThrow();
    });
});
