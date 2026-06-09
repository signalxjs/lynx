/**
 * Request lifecycle logging for `fetch`, on the shared `@sigx/lynx-core`
 * logger under the `http` namespace.
 *
 * - request traces (`→` start / `←` finish, with a TTFB-vs-body-vs-total
 *   timing breakdown) log at `debug` — on by default in dev, silent in prod.
 * - failures log at `warn` so they stay visible at the production default level.
 *
 * Silence with `setLogLevel('warn')` / `disableNamespace('http')`, or raise to
 * `trace`/`debug` to see traces. Per-chunk events are intentionally not logged
 * (would flood SSE/streaming responses).
 */
import { createLogger } from '@sigx/lynx-core';

const log = createLogger('http');

interface Timing {
    method: string;
    url: string;
    start: number;
    firstByteAt?: number;
    status?: number;
    bytes: number;
}

// Per-request timing, keyed by the same id `fetch` assigns. Kept regardless of
// level (it's cheap and gives failure logs their method/url context); only the
// verbose `debug` lines are gated. Deleted on every terminal event.
const timings = new Map<number, Timing>();

function ms(n: number): string {
    return `${Math.round(n)}ms`;
}

function size(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function start(id: number, method: string, url: string): void {
    timings.set(id, { method, url, start: Date.now(), bytes: 0 });
    if (log.enabled('debug')) log.debug(`→ ${method} ${url}`);
}

export function response(id: number, status: number): void {
    const t = timings.get(id);
    if (!t) return;
    t.firstByteAt = Date.now();
    t.status = status;
}

export function addBytes(id: number, n: number): void {
    const t = timings.get(id);
    if (t) t.bytes += n;
}

export function finish(id: number): void {
    const t = timings.get(id);
    if (!t) return;
    timings.delete(id);
    if (!log.enabled('debug')) return;
    const now = Date.now();
    const total = now - t.start;
    const ttfb = t.firstByteAt ? t.firstByteAt - t.start : total;
    const body = t.firstByteAt ? now - t.firstByteAt : 0;
    log.debug(
        `← ${t.status ?? '?'} ${t.method} ${t.url}  ` +
        `(${ms(total)} total · TTFB ${ms(ttfb)} · body ${ms(body)} · ${size(t.bytes)})`,
    );
}

export function fail(id: number, message: string): void {
    // No timing → a terminal event already fired for this id; don't double-log.
    const t = timings.get(id);
    if (!t) return;
    timings.delete(id);
    log.warn(`✕ ${t.method} ${t.url}  (${ms(Date.now() - t.start)} · ${size(t.bytes)}) — ${message}`);
}

export function abort(id: number, reason: string): void {
    const t = timings.get(id);
    if (!t) return;
    timings.delete(id);
    if (!log.enabled('debug')) return;
    log.debug(`⊘ ${t.method} ${t.url}  (${ms(Date.now() - t.start)} · ${size(t.bytes)}) — aborted (${reason})`);
}
