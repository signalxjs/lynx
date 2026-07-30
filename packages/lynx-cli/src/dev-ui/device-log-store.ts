/**
 * A structured store for device logs, beside the shell's text one.
 *
 * `DeviceLogEntry` reaches the CLI with every dimension intact — level,
 * platform, client id, timestamp — and `formatDeviceLogLine` immediately
 * flattened it to an ANSI string. Nothing downstream could filter by anything,
 * and no amount of work on the dashboard could recover it: the structure was
 * gone one line after it arrived.
 *
 * This keeps the records. The text store is unchanged and still carries the
 * build/server stream, so `--no-ui`, non-TTY and the post-mortem trail behave
 * exactly as before.
 *
 * One dimension comes free. `@sigx/lynx-core`'s default transport emits
 * `[${namespace}]` as the first console argument (`transports/console.ts`), so
 * a `createLogger('http')` line is machine-identifiable — which means the
 * dashboard can filter on the same namespaces `signalx.config.ts` can silence.
 */
import { signal } from '@sigx/terminal';
import type { DeviceLogEntry } from '../device-log.js';

/** Ordered by severity — the index *is* the comparison. */
export const LEVELS = ['trace', 'debug', 'log', 'info', 'warn', 'error'] as const;
export type Level = typeof LEVELS[number];

const LEVEL_RANK = new Map<string, number>(LEVELS.map((l, i) => [l, i]));

/** Theme tokens, not raw SGR — `device-log.ts` keeps its escapes for `--no-ui`. */
export const LEVEL_TONE: Record<Level, string> = {
    trace: 'faint',
    debug: 'dim',
    log: 'fg',
    info: 'info',
    warn: 'warn',
    error: 'danger',
};

export const LEVEL_LABEL: Record<Level, string> = {
    trace: 'TRC',
    debug: 'DBG',
    log: 'LOG',
    info: 'INF',
    warn: 'WRN',
    error: 'ERR',
};

export interface DeviceLogRecord {
    /** Monotonic. The row identity, and the tiebreak that keeps sorts stable. */
    seq: number;
    ts: number;
    level: Level;
    platform: string;
    client: number;
    /** `[ns]` from the core logger's console transport, or null. */
    namespace: string | null;
    /** All args joined — what the detail view shows. */
    message: string;
    /** First line only, for the single-line table cell. */
    head: string;
    /** `> 1` means the cell shows a `⏎n` marker and there is more to see. */
    lineCount: number;
}

export interface DeviceLogFilter {
    /** Minimum severity, or null for everything. */
    minLevel: Level | null;
    /** Exact platform match, or null for all. */
    platform: string | null;
    /** Exact namespace match, or null for all. `''` matches un-namespaced. */
    namespace: string | null;
    /** Case-insensitive substring over the message. */
    text: string;
}

export interface DeviceLogStore {
    push(entry: DeviceLogEntry): void;
    clear(): void;
    /** Every retained record, oldest first. Reactive. */
    records(): readonly DeviceLogRecord[];
    /** Records passing the current filter, oldest first. Reactive, memoised. */
    visible(): readonly DeviceLogRecord[];
    /** Mutate in place to re-filter; the store is signal-backed. */
    readonly filter: DeviceLogFilter;
    /** Whether any filter is narrowing the view. */
    isFiltered(): boolean;
    /** Platforms actually seen, for cycling the platform filter. */
    platforms(): readonly string[];
    /** Namespaces actually seen (excluding un-namespaced). */
    namespaces(): readonly string[];
    total(): number;
    hidden(): number;
}

/**
 * Retained records. Deliberately lower than `createLogStore`'s 10 000: each
 * record holds the full message plus derived fields, and `visible()` is a scan.
 * The text store keeps its own larger buffer, so the full history is still
 * scrollable in the Build tab — this is the interactive working set.
 */
const DEFAULT_LIMIT = 2_000;

/** `[ns]` exactly — the shape `consoleTransport` emits as `args[0]`. */
const NAMESPACE_RE = /^\[([^\]]+)\]$/;

function normaliseLevel(level: string): Level {
    return LEVEL_RANK.has(level) ? level as Level : 'log';
}

export function rankOf(level: Level): number {
    return LEVEL_RANK.get(level) ?? 0;
}

/**
 * Split `[ns]` off the front of the args, if present.
 *
 * Only an exact `[…]` first argument counts. A message that merely *starts*
 * with a bracket — `console.log('[warn] hand-rolled')` — is one argument, not
 * two, so it is left alone rather than being mined for a namespace it never
 * declared.
 */
export function splitNamespace(args: readonly string[]): { namespace: string | null; rest: string[] } {
    const first = args[0];
    if (args.length > 1 && typeof first === 'string') {
        const m = NAMESPACE_RE.exec(first);
        if (m) return { namespace: m[1]!, rest: args.slice(1).map(String) };
    }
    return { namespace: null, rest: args.map(String) };
}

export function createDeviceLogStore(opts: { limit?: number } = {}): DeviceLogStore {
    const limit = Math.max(1, opts.limit ?? DEFAULT_LIMIT);
    const state = signal({
        records: [] as DeviceLogRecord[],
        filter: { minLevel: null, platform: null, namespace: null, text: '' } as DeviceLogFilter,
    });

    let seq = 0;
    /** Bumped on every mutation of the buffer — the memo's invalidation half. */
    let version = 0;
    let cache: { key: string; rows: DeviceLogRecord[] } | null = null;

    const matches = (r: DeviceLogRecord, f: DeviceLogFilter): boolean => {
        if (f.minLevel && rankOf(r.level) < rankOf(f.minLevel)) return false;
        if (f.platform !== null && r.platform !== f.platform) return false;
        if (f.namespace !== null && (r.namespace ?? '') !== f.namespace) return false;
        if (f.text && !r.message.toLowerCase().includes(f.text.toLowerCase())) return false;
        return true;
    };

    const store: DeviceLogStore = {
        push(entry) {
            const { namespace, rest } = splitNamespace(entry.args);
            const message = rest.join(' ');
            const lines = message.split('\n');
            state.records.push({
                seq: seq++,
                ts: entry.ts,
                level: normaliseLevel(entry.level),
                platform: entry.platform,
                client: entry.client,
                namespace,
                message,
                head: lines[0] ?? '',
                lineCount: lines.length,
            });
            if (state.records.length > limit) {
                state.records.splice(0, state.records.length - limit);
            }
            version++;
        },

        clear() {
            state.records.splice(0, state.records.length);
            version++;
        },

        records() {
            return state.records;
        },

        visible() {
            const f = state.filter;
            // Keyed on the filter's *values*, so a caller can mutate
            // `store.filter` like the plain object it is without having to
            // remember to invalidate anything.
            //
            // The buffer half is a monotonic counter, NOT the record count.
            // At the limit every push evicts one and appends one, so the count
            // is constant while the contents turn over completely — keying on
            // it froze the view exactly when logs were busiest, which is the
            // case this store exists for.
            // JSON, not string concatenation. Two of these fields are
            // free-form — a namespace comes from `[…]` on the wire and may
            // contain a separator, and `text` is whatever a caller sets — so
            // joining on a delimiter lets distinct filters collide:
            // `{ns: 'x', text: 'y|z'}` and `{ns: 'x|y', text: 'z'}` produce the
            // same key. Unreachable today (nothing sets `text`), and exactly
            // the trap that springs on whoever adds a search box.
            const key = `${version}|${JSON.stringify([f.minLevel, f.platform, f.namespace, f.text])}`;
            if (cache && cache.key === key) return cache.rows;
            const rows = state.records.filter((r) => matches(r, f));
            cache = { key, rows };
            return rows;
        },

        get filter() {
            return state.filter;
        },

        isFiltered() {
            const f = state.filter;
            return f.minLevel !== null || f.platform !== null || f.namespace !== null || f.text !== '';
        },

        platforms() {
            return [...new Set(state.records.map((r) => r.platform))].sort();
        },

        namespaces() {
            return [...new Set(state.records.map((r) => r.namespace).filter((n): n is string => !!n))].sort();
        },

        total() {
            return state.records.length;
        },

        hidden() {
            return state.records.length - store.visible().length;
        },
    };

    return store;
}
