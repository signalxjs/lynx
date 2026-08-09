/**
 * Lynx engine memory usage — the resource half of observability (#953).
 *
 * A reading is **process-global**: one query covers every LynxView in the app,
 * and the per-instance rows tell you which one is holding what. The pairing
 * that matters for diagnosing runaway element trees is
 * {@link MemoryInstanceUsage.elementBytes} against
 * {@link MemoryInstanceUsage.elementNodeCount}.
 *
 * This is the engine's on-demand query, not its passive `memory` performance
 * entry. That entry exists, and `MemoryUsageEntry` is even declared in
 * `@lynx-js/types`, but the engine emits it to *platform* observers only — it
 * never reaches the JS runtimes, which is why this needs a native module at
 * all. See {@link ../README.md} Gotchas.
 *
 * Requires Lynx >= 4.0.1.
 */
import { callAsync, createLogger, isModuleAvailable, unwrapNative } from '@sigx/lynx-core';
import type { LogLevelName } from '@sigx/lynx-core';

const MODULE = 'Observability';
const PKG = 'lynx-observability';
const log = createLogger('memory');

/**
 * Whether every registered instance reported before the collection timeout.
 *
 * `'unknown'` is what a future engine enum member degrades to — the native side
 * maps the enum to a string so a new value can't be mistaken for an existing one.
 */
export type MemoryCollectionStatus = 'completed' | 'timeout' | 'unknown';

/** Memory attributed to one LynxView. */
export interface MemoryInstanceUsage {
    /** `null` when the instance was never fully attached (native reports `-1`). */
    instanceId: number | null;
    /**
     * Engine-side page identity. Currently derived from the view rather than
     * being the real page id — upstream has a TODO to replace it — so treat it
     * as a debugging label, not a key.
     */
    pageId: string;
    /** Template URL captured when this instance's fetcher completed. */
    url: string;
    /** `elementBytes` + `viewBytes` + both runtime figures, for this instance. */
    totalBytes: number;
    /** Element-tree memory from the native element manager. */
    elementBytes: number;
    /** Element node count — the context that makes `elementBytes` readable. */
    elementNodeCount: number;
    /** Platform UI memory (`LynxUIOwner` on iOS, the UI owner on Android). */
    viewBytes: number;
    /** Main-thread runtime heap. Sampled without forcing a GC. */
    mainThreadRuntimeBytes: number;
    /** Background-thread runtime heap. Sampled without forcing a GC. */
    backgroundThreadRuntimeBytes: number;
    /**
     * Background runtime group. Instances sharing a non-empty group share one
     * runtime, and the global total counts those bytes once — so summing
     * `backgroundThreadRuntimeBytes` across instances can exceed the global
     * figure, by design.
     */
    btsRuntimeGroupId: string;
}

/** One process-global memory reading. */
export interface MemoryUsageSnapshot {
    /**
     * `'timeout'` means at least one instance didn't report in time, and every
     * aggregate below is a **partial** sum over `completedInstanceCount` of
     * `expectedInstanceCount`. Compare the two before trusting a delta.
     */
    collectionStatus: MemoryCollectionStatus;
    /** Wall-clock start of the collection, in ms. */
    collectionStartMs: number;
    /** How long the collection actually took, in ms. */
    collectionDurationMs: number;
    /** The timeout the engine applied, in ms. */
    collectionTimeoutMs: number;
    /** Live instances snapshotted when the request started. */
    expectedInstanceCount: number;
    /** Instances that reported in time and are included below. */
    completedInstanceCount: number;
    /** Lynx-attributed total. Excludes `appBytes`; shared runtimes counted once. */
    totalBytes: number;
    /** The app's whole physical footprint when the result was built. */
    appBytes: number;
    /** `totalBytes / appBytes`, or `0` when the engine couldn't sample `appBytes`. */
    ratioToApp: number;
    /** Element-tree bytes summed over completed instances. */
    elementBytes: number;
    /** Element nodes summed over completed instances. */
    elementNodeCount: number;
    /** Platform UI bytes summed over completed instances. */
    viewBytes: number;
    /** Main-thread runtime heap summed over completed instances. */
    mainThreadRuntimeBytes: number;
    /** Background runtime heap, with shared runtime groups deduplicated. */
    backgroundThreadRuntimeBytes: number;
    /** Completed instances, sorted by `totalBytes` descending. */
    instances: MemoryInstanceUsage[];
}

export interface MemoryQueryOptions {
    /**
     * How long the engine waits for every instance to report, in ms. Omit — or
     * pass `<= 0` — for the engine default of 2000 ms.
     *
     * A short timeout doesn't fail; it returns a partial result with
     * `collectionStatus: 'timeout'`.
     */
    timeoutMs?: number;
}

export interface MemoryReportingOptions extends MemoryQueryOptions {
    /**
     * Gap between the **end** of one reading and the start of the next, in ms.
     * Default 60000.
     */
    intervalMs?: number;
    /** Level the reading is logged at. Default `'info'`. */
    level?: Exclude<LogLevelName, 'silent'>;
    /** Take a reading straight away rather than waiting one interval. Default `true`. */
    immediate?: boolean;
    /**
     * How many per-instance rows ride along in the record. Default 5; `0` omits
     * them. The engine sorts by size, so the top N are the interesting ones —
     * and a record that grows with the app's LynxView count would eventually
     * dominate whatever your sink charges by.
     */
    maxInstances?: number;
    /** Extra callback per reading (analytics, a HUD, …). Throwing won't stop the loop. */
    onReading?: (snapshot: MemoryUsageSnapshot) => void;
}

/** Finite numbers only — a fetcher completing mid-teardown can emit garbage. */
const num = (v: unknown, fallback = 0): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const STATUSES: readonly string[] = ['completed', 'timeout', 'unknown'];

/**
 * A whole number for a knob that came in as untyped config. Anything unusable —
 * `NaN`, `Infinity`, a negative, a string — falls back rather than propagating
 * into a `setTimeout` delay or a `slice()` bound, where a `-1` quietly means
 * "drop the last one" instead of "none".
 */
const posInt = (v: unknown, fallback: number, min = 1): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= min ? Math.floor(v) : fallback;

/**
 * Bridge payloads have arrived as JSON *strings* before (#342), so parse that
 * case rather than handing the caller a snapshot full of zeroes.
 */
function asObject(raw: unknown): Record<string, unknown> | null {
    let value = raw;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            return null;
        }
    }
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function normalizeInstance(raw: unknown): MemoryInstanceUsage | null {
    const o = asObject(raw);
    if (!o) return null;
    // Native sends -1 for an instance that was never fully attached; `null`
    // says that in a way a caller can't accidentally arithmetic on.
    const id = num(o['instanceId'], -1);
    return {
        instanceId: id < 0 ? null : id,
        pageId: str(o['pageId']),
        url: str(o['url']),
        totalBytes: num(o['totalBytes']),
        elementBytes: num(o['elementBytes']),
        elementNodeCount: num(o['elementNodeCount']),
        viewBytes: num(o['viewBytes']),
        mainThreadRuntimeBytes: num(o['mainThreadRuntimeBytes']),
        backgroundThreadRuntimeBytes: num(o['backgroundThreadRuntimeBytes']),
        btsRuntimeGroupId: str(o['btsRuntimeGroupId']),
    };
}

/**
 * Every field defaulted, so a partially-populated engine result produces zeroes
 * rather than `NaN` — these numbers end up in log records and dashboards, where
 * a `NaN` propagates a lot further than a `0`.
 */
export function normalizeSnapshot(raw: unknown): MemoryUsageSnapshot {
    const o = asObject(raw) ?? {};
    const rawStatus = o['collectionStatus'];
    const instances = Array.isArray(o['instances']) ? o['instances'] : [];
    return {
        collectionStatus: (typeof rawStatus === 'string' && STATUSES.includes(rawStatus)
            ? rawStatus
            : 'unknown') as MemoryCollectionStatus,
        collectionStartMs: num(o['collectionStartMs']),
        collectionDurationMs: num(o['collectionDurationMs']),
        collectionTimeoutMs: num(o['collectionTimeoutMs']),
        expectedInstanceCount: num(o['expectedInstanceCount']),
        completedInstanceCount: num(o['completedInstanceCount']),
        totalBytes: num(o['totalBytes']),
        appBytes: num(o['appBytes']),
        ratioToApp: num(o['ratioToApp']),
        elementBytes: num(o['elementBytes']),
        elementNodeCount: num(o['elementNodeCount']),
        viewBytes: num(o['viewBytes']),
        mainThreadRuntimeBytes: num(o['mainThreadRuntimeBytes']),
        backgroundThreadRuntimeBytes: num(o['backgroundThreadRuntimeBytes']),
        instances: instances
            .map(normalizeInstance)
            .filter((i): i is MemoryInstanceUsage => i !== null),
    };
}

export const Memory = {
    /**
     * Take one process-global memory reading.
     *
     * Throws when the native module isn't linked (C3 — install
     * `@sigx/lynx-observability` and re-run `sigx prebuild`) and when the engine
     * reports a failure (C4).
     *
     * A `'timeout'` status is **not** an error: it resolves normally with a
     * partial result, and the caller decides whether a partial reading is worth
     * acting on.
     *
     * @example
     * ```ts
     * const m = await Memory.query();
     * console.log(`${(m.totalBytes / 1e6).toFixed(1)} MB, ${m.elementNodeCount} nodes`);
     * ```
     */
    async query(options: MemoryQueryOptions = {}): Promise<MemoryUsageSnapshot> {
        // Omitted rather than sent as undefined: native reads `hasKey`, and an
        // explicit undefined would make it take the "caller chose a timeout"
        // branch with nothing in it.
        const params: MemoryQueryOptions = {};
        if (options.timeoutMs !== undefined) params.timeoutMs = options.timeoutMs;
        // The module and method literals stay at the call site: `check:manifests`
        // reads them textually (C12), and a helper would hide them from it.
        const raw = await callAsync<unknown>(MODULE, 'queryMemoryUsage', params);
        return normalizeSnapshot(unwrapNative(PKG, 'queryMemoryUsage', raw));
    },

    /**
     * Sample memory on a timer, logging each reading under the `memory`
     * namespace so it reaches every registered transport — the `sigx dev`
     * terminal in development, and whatever {@link createHttpSink} points at in
     * production. Returns an unsubscribe (C7); calling it twice is a no-op.
     *
     * **Documented C3 opt-out:** when the native module isn't linked this logs
     * one `debug` line and returns a no-op disposer rather than throwing.
     * Reporting is ambient telemetry started from `install.ts` before app code
     * runs, so a throw would take down an app whose only mistake was forgetting
     * to re-run `sigx prebuild`. {@link Memory.query} keeps the default throw,
     * because there the caller asked for a number and needs to know they didn't
     * get one. Also in the README's Gotchas.
     *
     * @example
     * ```ts
     * const stop = Memory.startReporting({ intervalMs: 30_000 });
     * ```
     */
    startReporting(options: MemoryReportingOptions = {}): () => void {
        if (!isModuleAvailable(MODULE)) {
            log.debug('native module not linked — memory reporting disabled');
            return () => { /* nothing was started */ };
        }

        // These arrive from `signalx.config.ts` via a build-time define as well
        // as from a typed call site, so the types are a suggestion here, not a
        // guarantee. `'silent'` in particular has no method on the logger and
        // would throw on the first reading.
        const intervalMs = posInt(options.intervalMs, 60_000);
        // Widened before the check: the declared type already excludes
        // `'silent'`, so TS would call the comparison dead — but injected config
        // isn't type-checked at runtime, and `log.silent` doesn't exist.
        const declared = options.level as LogLevelName | undefined;
        const level: Exclude<LogLevelName, 'silent'> = declared && declared !== 'silent'
            ? declared
            : 'info';
        const maxInstances = posInt(options.maxInstances, 5, 0);

        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const tick = async (): Promise<void> => {
            try {
                // Checked per tick, not once: `setLogLevel` can move at runtime.
                // Release builds default the threshold to `warn`, so the default
                // `info` reading would be dropped — and a process-global
                // collection every minute to produce nothing is worse than not
                // reporting. An `onReading` hook is its own reason to sample.
                if (!log.enabled(level) && !options.onReading) return;
                const snapshot = await Memory.query(options);
                // The disposer may have run while the query was in flight; a
                // reading logged after `stop()` would outlive the caller's
                // intent, which is the whole point of the disposer.
                if (stopped) return;
                const mb = (bytes: number): string => (bytes / 1_048_576).toFixed(1);
                log[level](
                    `${mb(snapshot.totalBytes)} MB across `
                    + `${snapshot.completedInstanceCount}/${snapshot.expectedInstanceCount} instance(s)`,
                    { ...snapshot, instances: snapshot.instances.slice(0, maxInstances) },
                );
                try {
                    options.onReading?.(snapshot);
                } catch {
                    // A caller's hook is not allowed to end the loop.
                }
            } catch (error) {
                // Every tick catches: an unhandled rejection on the background
                // runtime is a fatal main-thread exception under PrimJS (#863),
                // not a warning in a console someone might read.
                log.warn('memory reading failed', error);
            } finally {
                // Rescheduled from completion, not on a fixed interval: a query
                // can take the full engine timeout, and `setInterval` would
                // stack overlapping process-global collections.
                if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
            }
        };

        if (options.immediate === false) timer = setTimeout(() => void tick(), intervalMs);
        else void tick();

        return () => {
            if (stopped) return;
            stopped = true;
            if (timer !== undefined) {
                clearTimeout(timer);
                timer = undefined;
            }
        };
    },

    /** Is the native module linked in this build? (C2) */
    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
