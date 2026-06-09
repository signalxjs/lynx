/**
 * Tiny leveled + namespaced logger for sigx-lynx.
 *
 * Zero-dependency and small enough to live in `@sigx/lynx-core` so every
 * package can log without taking a new dependency. Records flow to pluggable
 * {@link LogTransport}s; the default {@link consoleTransport} routes to
 * `console.*`, which `@sigx/lynx-dev-client` patches and streams to the
 * `sigx dev` terminal in development — so logs surface with no extra wiring.
 *
 * Levels mirror the `react-native-logs` model (a name → severity map with a
 * single threshold) so external providers map cleanly. Production error
 * capture and remote provider sinks live in the opt-in `@sigx/lynx-observability`
 * package, which registers additional transports here.
 *
 * @example
 * ```ts
 * import { createLogger } from '@sigx/lynx-core';
 * const log = createLogger('http');
 * log.debug('→ GET /users');
 * log.error('request failed', err);
 * ```
 */

// Injected at app-build time by `@sigx/lynx-plugin` (source.define) as a plain
// string literal — `'debug'` under `sigx dev`, `'warn'` for release builds.
// Read via a `typeof` guard so it stays safe under tsgo, vitest, and any host
// where the define didn't run (no `__DEV__`/`process` reference at runtime —
// the `__DEV__` define expands to a `process.env` expression that throws in
// the Lynx BG runtime, so the logger must not depend on it).
declare const __SIGX_LOG_LEVEL__: string | undefined;

export type LogLevelName = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

/** Severity per level — higher is more important; `silent` suppresses all. */
const SEVERITY: Record<LogLevelName, number> = {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
    silent: 100,
};

/** A single structured log record handed to every transport. */
export interface LogRecord {
    readonly level: { readonly name: LogLevelName; readonly severity: number };
    readonly namespace: string;
    readonly msg: string;
    /** Extra args passed after the message (objects, errors, values). */
    readonly fields: readonly unknown[];
    /** `Date.now()` when the record was created. */
    readonly ts: number;
}

/** A sink that receives emitted records (console, dev-stream, remote provider…). */
export type LogTransport = (record: LogRecord) => void;

/** Namespaced logger returned by {@link createLogger}. */
export interface Logger {
    trace(msg: string, ...fields: unknown[]): void;
    debug(msg: string, ...fields: unknown[]): void;
    info(msg: string, ...fields: unknown[]): void;
    warn(msg: string, ...fields: unknown[]): void;
    error(msg: string, ...fields: unknown[]): void;
    /** True if a record at `level` from this namespace would be emitted — guard hot paths. */
    enabled(level: LogLevelName): boolean;
}

function resolveDefaultLevel(): LogLevelName {
    const injected = typeof __SIGX_LOG_LEVEL__ !== 'undefined' ? __SIGX_LOG_LEVEL__ : undefined;
    if (injected && Object.prototype.hasOwnProperty.call(SEVERITY, injected)) {
        return injected as LogLevelName;
    }
    // Not injected (vitest, or a build without @sigx/lynx-plugin): default to
    // `debug`. The plugin injects `'warn'` for release builds.
    return 'debug';
}

let threshold: number = SEVERITY[resolveDefaultLevel()];
const disabled = new Set<string>();
let transports: LogTransport[] = [];

/** Set the minimum level emitted globally (e.g. `'warn'`, `'silent'`). */
export function setLogLevel(name: LogLevelName): void {
    const sev = SEVERITY[name];
    if (sev !== undefined) threshold = sev;
}

/** Current global minimum level. */
export function getLogLevel(): LogLevelName {
    for (const name of Object.keys(SEVERITY) as LogLevelName[]) {
        if (SEVERITY[name] === threshold) return name;
    }
    return 'debug';
}

/** Re-enable a namespace previously silenced with {@link disableNamespace}. */
export function enableNamespace(namespace: string): void {
    disabled.delete(namespace);
}

/** Silence all output from a namespace regardless of level. */
export function disableNamespace(namespace: string): void {
    disabled.add(namespace);
}

/** Register an additional transport (called in addition to existing ones). */
export function addTransport(transport: LogTransport): void {
    transports.push(transport);
}

/** Remove all transports (e.g. to replace the default in tests/embeds). */
export function clearTransports(): void {
    transports = [];
}

function shouldEmit(namespace: string, severity: number): boolean {
    return severity >= threshold && !disabled.has(namespace);
}

function emit(namespace: string, name: LogLevelName, msg: string, fields: unknown[]): void {
    const severity = SEVERITY[name];
    if (!shouldEmit(namespace, severity)) return;
    const record: LogRecord = { level: { name, severity }, namespace, msg, fields, ts: Date.now() };
    for (const transport of transports) {
        // Logging must never throw into the caller.
        try {
            transport(record);
        } catch {
            /* swallow transport errors */
        }
    }
}

/** Create a logger bound to `namespace`. Cheap — make one per module. */
export function createLogger(namespace: string): Logger {
    return {
        trace: (msg, ...fields) => emit(namespace, 'trace', msg, fields),
        debug: (msg, ...fields) => emit(namespace, 'debug', msg, fields),
        info: (msg, ...fields) => emit(namespace, 'info', msg, fields),
        warn: (msg, ...fields) => emit(namespace, 'warn', msg, fields),
        error: (msg, ...fields) => emit(namespace, 'error', msg, fields),
        enabled: (level) => shouldEmit(namespace, SEVERITY[level] ?? 0),
    };
}
