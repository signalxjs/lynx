/**
 * Device → dev-server console streamer.
 *
 * Patches `console.log/info/warn/error/debug/trace`, defensively serialises
 * each argument, buffers entries in a bounded queue, and ships batches to
 * the lynx dev server over a single persistent WebSocket. The original
 * console methods are still invoked so the on-device Lynx logbox and the
 * Chrome inspector keep working.
 *
 * Design notes
 * ------------
 * - WebSocket (not HTTP) — the Lynx BG runtime on Android lacks `fetch`,
 *   `XMLHttpRequest`, and `lynx.fetch`, but ships a native WebSocket via
 *   `@sigx/lynx-websocket` (URLSessionWebSocketTask on iOS, OkHttp on
 *   Android). Importing `@sigx/lynx-websocket` attaches a WHATWG-shaped
 *   `WebSocket` class to `globalThis`, which this module consumes.
 * - Bounded queue (`maxQueueSize`) protects against runaway log loops if the
 *   server is unreachable for an extended period.
 * - Re-entrancy guard prevents `console.log` calls triggered inside our own
 *   serialisation / send code from recursing.
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

/** Minimal WHATWG WebSocket shape this streamer relies on. */
export interface MinimalWebSocket {
    readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    onopen: ((ev: unknown) => void) | null;
    onmessage: ((ev: unknown) => void) | null;
    onerror: ((ev: unknown) => void) | null;
    onclose: ((ev: unknown) => void) | null;
}

export type WebSocketCtor = new (url: string, protocols?: string | string[]) => MinimalWebSocket;

export interface InstallOptions {
    /**
     * Override the platform tag. If omitted, we sniff `globalThis.lynx` /
     * `navigator.userAgent` / `process` to make a best guess.
     */
    platform?: string;
    /** Max entries kept in memory while disconnected. @default 500 */
    maxQueueSize?: number;
    /** Flush batch size — max entries per WebSocket message. @default 50 */
    flushBatchSize?: number;
    /** Coalesce interval for non-error logs. @default 100 */
    flushIntervalMs?: number;
    /** Initial reconnect/backoff delay in ms. @default 1000 */
    backoffInitialMs?: number;
    /** Backoff cap in ms. @default 30000 */
    backoffMaxMs?: number;
    /**
     * WebSocket constructor. Defaults to `globalThis.WebSocket`, which is
     * installed by `@sigx/lynx-websocket`'s side-effect import.
     */
    webSocketImpl?: WebSocketCtor;
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

const WS_CONNECTING = 0;
const WS_OPEN = 1;

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

// Lynx's BG runtime exposes `lynx` and a handful of platform-specific
// globals (`webkit` on iOS) as closure-injected bindings on the module
// wrapper — NOT on `globalThis`. We declare them ambient here so the
// references resolve through the runtime's lexical scope.
declare const lynx: { SystemInfo?: { platform?: string } } | undefined;
declare const webkit: unknown;

function detectPlatform(): string {
    try {
        // SystemInfo is only populated on the MainThread runtime; on BG it's
        // missing, so this is mostly useful in MT contexts / tests.
        if (typeof lynx !== 'undefined') {
            const p = lynx?.SystemInfo?.platform?.toLowerCase?.();
            if (p === 'ios' || p === 'android') return p;
        }
        // iOS BG runtime ships a `webkit` closure-arg (UIWebView/WKWebView
        // bridge). No equivalent on Android BG, so its presence is a
        // reliable iOS hint.
        if (typeof webkit !== 'undefined') return 'ios';
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
 * restores the original `console.*` methods and tears down the WebSocket.
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

    const WS: WebSocketCtor | undefined =
        opts.webSocketImpl ?? (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
    if (!WS) {
        // No WebSocket on this runtime → we can't ship logs. Bail gracefully.
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
    // Platform detection is lazy: `lynx.SystemInfo` may not be populated
    // when the streamer installs (we run at the very top of the BG bundle).
    // Re-detect on each enqueue until we get a non-`unknown` answer.
    let platform = opts.platform ?? detectPlatform();

    // Lynx BG runtime ships `log/info/warn/error` but is allowed to omit
    // `debug` and `trace`. Fall back to `log` so missing methods don't kill
    // the install step with "cannot read property 'bind' of undefined".
    const noop = (): void => undefined;
    const grab = (fn: ((...a: unknown[]) => void) | undefined, fallback: (...a: unknown[]) => void): (...a: unknown[]) => void => {
        if (typeof fn === 'function') {
            try { return fn.bind(target); } catch { return fallback; }
        }
        return fallback;
    };
    const origLog = grab(target.log, noop);
    const originals: Record<LogLevel, (...args: unknown[]) => void> = {
        log: origLog,
        info: grab(target.info, origLog),
        warn: grab(target.warn, origLog),
        error: grab(target.error, origLog),
        debug: grab(target.debug, origLog),
        trace: grab(target.trace, origLog),
    };

    const queue: LogEntry[] = [];
    let ws: MinimalWebSocket | undefined;
    let pendingFlushTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingReconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let backoff = backoffInitialMs;
    let reentrant = false;
    let uninstalled = false;

    const clearFlushTimer = (): void => {
        if (pendingFlushTimer !== undefined) {
            clearTimeoutFn(pendingFlushTimer);
            pendingFlushTimer = undefined;
        }
    };
    const clearReconnectTimer = (): void => {
        if (pendingReconnectTimer !== undefined) {
            clearTimeoutFn(pendingReconnectTimer);
            pendingReconnectTimer = undefined;
        }
    };

    const teardownSocket = (): void => {
        if (!ws) return;
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        try { ws.close(); } catch { /* ignore */ }
        ws = undefined;
    };

    const scheduleReconnect = (): void => {
        if (uninstalled || pendingReconnectTimer !== undefined) return;
        const delay = backoff;
        backoff = Math.min(backoff * 2, backoffMaxMs);
        pendingReconnectTimer = setTimeoutFn(() => {
            pendingReconnectTimer = undefined;
            connect();
        }, delay) as ReturnType<typeof setTimeout>;
    };

    const onSocketDown = (err?: unknown): void => {
        if (uninstalled) return;
        teardownSocket();
        clearFlushTimer();
        if (err !== undefined) {
            originals.warn(
                '[sigx-dev-client] log stream WS closed, reconnecting:',
                (err as { message?: string })?.message ?? err,
            );
        }
        scheduleReconnect();
    };

    const connect = (): void => {
        if (uninstalled || ws) return;
        let socket: MinimalWebSocket;
        try {
            socket = new WS(url);
        } catch (err) {
            originals.warn('[sigx-dev-client] log stream WS construct failed:', err);
            scheduleReconnect();
            return;
        }
        ws = socket;
        socket.onopen = () => {
            if (uninstalled || ws !== socket) return;
            backoff = backoffInitialMs;
            pump();
        };
        // Server doesn't send anything; we still wire it so the runtime
        // doesn't complain about unhandled events on some hosts.
        socket.onmessage = () => undefined;
        socket.onerror = (ev) => {
            if (uninstalled || ws !== socket) return;
            onSocketDown((ev as { message?: string })?.message ?? 'ws error');
        };
        socket.onclose = (ev) => {
            if (uninstalled || ws !== socket) return;
            const reason = (ev as { reason?: string })?.reason;
            onSocketDown(reason ? `closed: ${reason}` : 'closed');
        };
    };

    const pump = (): void => {
        if (uninstalled || !ws || ws.readyState !== WS_OPEN) return;
        while (queue.length > 0) {
            const batch = queue.splice(0, flushBatchSize);
            try {
                ws.send(JSON.stringify({ entries: batch }));
            } catch (err) {
                // Re-queue the batch at the FRONT so order is preserved.
                queue.unshift(...batch);
                if (queue.length > maxQueueSize) {
                    queue.splice(maxQueueSize, queue.length - maxQueueSize);
                }
                onSocketDown((err as { message?: string })?.message ?? err);
                return;
            }
        }
    };

    const scheduleFlush = (delay: number): void => {
        if (uninstalled || pendingFlushTimer !== undefined) return;
        pendingFlushTimer = setTimeoutFn(() => {
            pendingFlushTimer = undefined;
            if (ws && ws.readyState === WS_OPEN) {
                pump();
            } else if (!ws) {
                connect();
            }
            // If we're still CONNECTING, the onopen handler will drain.
        }, delay) as ReturnType<typeof setTimeout>;
    };

    const enqueue = (level: LogLevel, args: unknown[]): void => {
        if (uninstalled || reentrant) return;
        reentrant = true;
        try {
            if (platform === 'unknown' && !opts.platform) {
                platform = detectPlatform();
            }
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
            if (!ws) {
                // Socket is between disconnect and reconnect — the scheduled
                // reconnect timer will pick this up. Don't bypass the backoff.
                return;
            }
            if (ws.readyState === WS_OPEN) {
                // Errors flush immediately, everything else coalesces.
                if (level === 'error') pump();
                else scheduleFlush(flushIntervalMs);
            }
            // CONNECTING → onopen will pump.
            // CLOSING / CLOSED → onclose handler already scheduled reconnect.
        } catch {
            // Swallow — never propagate serialiser bugs to user code.
        } finally {
            reentrant = false;
        }
    };

    // Patch each level. We define plain functions (not arrow) so callers
    // that pass `console.log` as a callback get a stable function identity
    // that's restorable. Assignment is guarded because some BG runtimes ship
    // a frozen `console` object — in which case we can still queue via the
    // few methods we did manage to replace.
    const patchedKeys: LogLevel[] = [];
    for (const level of LEVELS) {
        const original = originals[level];
        const patched = function patched(this: unknown, ...args: unknown[]): void {
            try { original(...args); } catch { /* ignore */ }
            enqueue(level, args);
        };
        try {
            (target as unknown as Record<string, unknown>)[level] = patched;
            patchedKeys.push(level);
        } catch { /* frozen — leave as-is */ }
    }

    const uninstall: Uninstall = () => {
        if (uninstalled) return;
        uninstalled = true;
        clearFlushTimer();
        clearReconnectTimer();
        teardownSocket();
        for (const level of patchedKeys) {
            try { (target as unknown as Record<string, unknown>)[level] = originals[level]; }
            catch { /* frozen */ }
        }
        try { delete (target as unknown as Record<string, unknown>)[markerKey]; }
        catch { /* frozen */ }
    };
    (target as unknown as Record<string, unknown>)[markerKey] = uninstall;

    // Eagerly connect so the boot-time `[sigx-dev-client] ws streamer ready`
    // log lands on a socket that's at least CONNECTING by the time it fires.
    connect();

    return uninstall;
}
