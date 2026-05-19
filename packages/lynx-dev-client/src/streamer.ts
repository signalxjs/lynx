/**
 * Device → dev-server console streamer.
 *
 * Patches `console.log/info/warn/error/debug/trace`, defensively serialises
 * each argument, buffers entries in a bounded queue, and ships batches to
 * the lynx dev server over HTTP POST. The original console methods are still
 * invoked so the on-device Lynx logbox and the Chrome inspector keep working.
 *
 * Design notes
 * ------------
 * - HTTP POST batching (not WebSocket) — keeps the implementation dependency-
 *   free and works with rsbuild's connect-style middleware API. Each flush
 *   sends up to `flushBatchSize` entries; flushes are scheduled on a
 *   `flushIntervalMs` timer and immediately on `error`-level logs.
 * - Bounded queue (`maxQueueSize`) protects against runaway log loops if the
 *   server is unreachable for an extended period.
 * - Re-entrancy guard prevents `console.log` calls triggered inside our own
 *   serialisation / network code from recursing.
 * - WebSocket / network failures NEVER call the patched `console.*` — they
 *   route through the captured originals so a broken streamer can't generate
 *   an infinite stream of its own error logs.
 * - Production safety: this module lives in `@sigx/lynx-dev-client`, which is
 *   a `devDependency`, and the lynx plugin only injects the install entry in
 *   dev mode. Release builds carry zero overhead.
 */

const LEVELS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
export type LogLevel = (typeof LEVELS)[number];

export interface LogEntry {
    /** Console method that was called. */
    level: LogLevel;
    /** Pre-formatted argument strings (one per `console.log` argument). */
    args: string[];
    /** Milliseconds since the unix epoch on the device. */
    ts: number;
    /** Platform hint — `'ios' | 'android' | 'unknown'`. */
    platform: string;
}

export interface InstallOptions {
    /**
     * Override the platform tag. If omitted, we sniff `globalThis.lynx` /
     * `navigator.userAgent` / `process` to make a best guess.
     */
    platform?: string;
    /** Max entries kept in memory while disconnected. @default 500 */
    maxQueueSize?: number;
    /** Flush batch size. @default 50 */
    flushBatchSize?: number;
    /** Flush interval in ms. @default 100 */
    flushIntervalMs?: number;
    /** Initial reconnect/backoff delay in ms. @default 1000 */
    backoffInitialMs?: number;
    /** Backoff cap in ms. @default 30000 */
    backoffMaxMs?: number;
    /**
     * Override the fetch implementation. Defaults to `globalThis.fetch`,
     * which Lynx ships on the BG runtime.
     */
    fetchImpl?: typeof fetch;
    /** Override the timer. Defaults to `setTimeout`. (Test seam.) */
    setTimeoutImpl?: typeof setTimeout;
    /** Override the clearer. Defaults to `clearTimeout`. (Test seam.) */
    clearTimeoutImpl?: typeof clearTimeout;
    /** Override `Date.now()`. (Test seam.) */
    nowImpl?: () => number;
}

export type Uninstall = () => void;

interface ConsoleLike {
    log: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
    trace: (...args: unknown[]) => void;
}

/**
 * Serialise a single `console.log` argument to a string in a way that never
 * throws and produces useful output for objects, errors, primitives, and
 * tricky types (circular refs, `BigInt`, `Symbol`, `undefined`, functions).
 *
 * We intentionally produce a string (rather than a structured JSON value) so
 * the wire format stays simple and the server can print it verbatim.
 */
export function serializeArg(value: unknown, seen: WeakSet<object> = new WeakSet()): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';

    const t = typeof value;
    if (t === 'string') return value as string;
    if (t === 'number' || t === 'boolean') return String(value);
    if (t === 'bigint') return `${String(value)}n`;
    if (t === 'symbol') return (value as symbol).toString();
    if (t === 'function') {
        const name = (value as { name?: string }).name;
        return `[Function${name ? `: ${name}` : ''}]`;
    }

    if (value instanceof Error) {
        // `stack` already includes name + message on V8/JSC.
        return value.stack || `${value.name}: ${value.message}`;
    }

    if (typeof value === 'object') {
        const obj = value as object;
        if (seen.has(obj)) return '[Circular]';
        seen.add(obj);

        try {
            if (Array.isArray(value)) {
                const parts = value.map((v) => serializeArg(v, seen));
                return `[${parts.join(', ')}]`;
            }
            // Try JSON first — fast path for plain data.
            const json = JSON.stringify(value, (_k, v) => {
                if (typeof v === 'bigint') return `${v.toString()}n`;
                if (typeof v === 'symbol') return v.toString();
                if (typeof v === 'function') return `[Function${v.name ? `: ${v.name}` : ''}]`;
                if (typeof v === 'undefined') return '[undefined]';
                return v;
            });
            if (json !== undefined) return json;
        } catch {
            // Fall through to manual walk.
        }

        // Manual walk for objects JSON refuses (circular, etc.)
        try {
            const keys = Object.keys(obj);
            const parts = keys.map((k) => `${k}: ${serializeArg((obj as Record<string, unknown>)[k], seen)}`);
            return `{ ${parts.join(', ')} }`;
        } catch {
            return '[Unserialisable]';
        }
    }

    return String(value);
}

function detectPlatform(): string {
    try {
        const g = globalThis as Record<string, unknown>;
        if (g['lynx']) {
            // Lynx exposes a SystemInfo with `platform` ('iOS' | 'Android').
            const sys = (g['lynx'] as { SystemInfo?: { platform?: string } }).SystemInfo;
            const p = sys?.platform?.toLowerCase?.();
            if (p === 'ios' || p === 'android') return p;
        }
        if (typeof navigator !== 'undefined' && navigator?.userAgent) {
            const ua = navigator.userAgent.toLowerCase();
            if (ua.includes('android')) return 'android';
            if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'ios';
        }
    } catch {
        // best-effort
    }
    return 'unknown';
}

/**
 * Install the console streamer. Returns an `uninstall` function that
 * restores the original `console.*` methods and stops the flush loop.
 *
 * Calling `installConsoleStreamer` more than once is safe but a no-op after
 * the first install — the second call returns the previous uninstall.
 */
export function installConsoleStreamer(url: string, opts: InstallOptions = {}): Uninstall {
    if (!url || typeof url !== 'string') {
        // Don't patch if we don't know where to send logs.
        return () => undefined;
    }

    const target = (globalThis as { console?: ConsoleLike }).console;
    if (!target) return () => undefined;

    // Re-install guard: if a previous installer is active, return its
    // uninstall. The marker lives on the console instance.
    const markerKey = '__sigxLogStreamerUninstall__';
    const existing = (target as unknown as Record<string, unknown>)[markerKey];
    if (typeof existing === 'function') return existing as Uninstall;

    const fetchImpl = opts.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;
    if (!fetchImpl) {
        // No fetch on this runtime → we can't ship logs. Bail out gracefully.
        return () => undefined;
    }
    const setTimeoutFn = opts.setTimeoutImpl ?? setTimeout;
    const clearTimeoutFn = opts.clearTimeoutImpl ?? clearTimeout;
    const now = opts.nowImpl ?? (() => Date.now());

    const maxQueueSize = opts.maxQueueSize ?? 500;
    const flushBatchSize = opts.flushBatchSize ?? 50;
    const flushIntervalMs = opts.flushIntervalMs ?? 100;
    const backoffInitialMs = opts.backoffInitialMs ?? 1000;
    const backoffMaxMs = opts.backoffMaxMs ?? 30_000;
    const platform = opts.platform ?? detectPlatform();

    const originals: Record<LogLevel, (...args: unknown[]) => void> = {
        log: target.log.bind(target),
        info: target.info.bind(target),
        warn: target.warn.bind(target),
        error: target.error.bind(target),
        debug: target.debug.bind(target),
        trace: target.trace.bind(target),
    };

    const queue: LogEntry[] = [];
    let pendingTimer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let backoff = backoffInitialMs;
    let reentrant = false;
    let uninstalled = false;

    const scheduleFlush = (delay: number): void => {
        if (uninstalled) return;
        if (pendingTimer !== undefined) return;
        pendingTimer = setTimeoutFn(() => {
            pendingTimer = undefined;
            void flush();
        }, delay) as ReturnType<typeof setTimeout>;
    };

    const flush = async (): Promise<void> => {
        if (uninstalled || inFlight || queue.length === 0) return;
        inFlight = true;
        const batch = queue.splice(0, flushBatchSize);
        try {
            const res = await fetchImpl(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entries: batch }),
            });
            if (!res || !('ok' in res) || !res.ok) {
                throw new Error(`bad response: ${res?.status ?? 'unknown'}`);
            }
            // Success — reset backoff and pull the next batch if any.
            backoff = backoffInitialMs;
            if (queue.length > 0) scheduleFlush(0);
        } catch (err) {
            // Re-queue the batch at the FRONT so order is preserved.
            queue.unshift(...batch);
            if (queue.length > maxQueueSize) {
                queue.splice(maxQueueSize, queue.length - maxQueueSize);
            }
            // Use the captured original to avoid recursion.
            originals.warn('[sigx-dev-client] log stream POST failed:', (err as Error)?.message ?? err);
            scheduleFlush(backoff);
            backoff = Math.min(backoff * 2, backoffMaxMs);
        } finally {
            inFlight = false;
        }
    };

    const enqueue = (level: LogLevel, args: unknown[]): void => {
        if (uninstalled || reentrant) return;
        reentrant = true;
        try {
            const formatted: string[] = [];
            for (const a of args) {
                formatted.push(serializeArg(a));
            }
            const entry: LogEntry = {
                level,
                args: formatted,
                ts: now(),
                platform,
            };
            queue.push(entry);
            if (queue.length > maxQueueSize) {
                queue.shift();
            }
            // Errors flush immediately, everything else coalesces.
            scheduleFlush(level === 'error' ? 0 : flushIntervalMs);
        } catch {
            // Swallow — never propagate serialiser bugs to user code.
        } finally {
            reentrant = false;
        }
    };

    // Patch each level. We define plain functions (not arrow) so callers
    // that pass `console.log` as a callback get a stable function identity
    // that's restorable.
    for (const level of LEVELS) {
        const original = originals[level];
        (target as unknown as Record<string, unknown>)[level] = function patched(...args: unknown[]): void {
            // Always invoke the original first so on-device logbox / devtool
            // see the call even if shipping fails.
            try { original(...args); } catch { /* ignore */ }
            enqueue(level, args);
        };
    }

    const uninstall: Uninstall = () => {
        if (uninstalled) return;
        uninstalled = true;
        if (pendingTimer !== undefined) {
            clearTimeoutFn(pendingTimer);
            pendingTimer = undefined;
        }
        for (const level of LEVELS) {
            (target as unknown as Record<string, unknown>)[level] = originals[level];
        }
        delete (target as unknown as Record<string, unknown>)[markerKey];
    };
    (target as unknown as Record<string, unknown>)[markerKey] = uninstall;

    return uninstall;
}
