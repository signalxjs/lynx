/**
 * Dev-server log receiver — piggy-backs on the rspeedy/rsbuild dev server.
 *
 * Architecture
 * ------------
 * - Devices POST batches of console entries to `/__sigx/logs` on the same
 *   host:port that already serves the lynx bundle. The lynx plugin installs
 *   a connect middleware via `dev.setupMiddlewares` to receive them.
 * - The plugin runs inside the rspeedy CHILD process, but the user-facing
 *   terminal is owned by the lynx CLI PARENT process. So instead of holding
 *   a direct channel, we emit a sentinel-tagged line on `process.stdout`
 *   that the CLI's existing stdout pipe in `dev-server.ts` recognises and
 *   pretty-prints.
 *
 * Sentinel format
 * ---------------
 *   `\u0000SIGX_LOG\u0000<json>\n`
 *
 * The leading NUL ensures the marker can't be confused with anything
 * rsbuild itself writes (rsbuild output is human-readable). The CLI strips
 * the marker before forwarding to the user terminal.
 *
 * Wire format (POST body)
 * -----------------------
 *   `{ entries: Array<{ level, args: string[], ts: number, platform: string }> }`
 *
 * Where `level` is one of `'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace'`.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

/** Sentinel that the CLI looks for on stdout. */
export const LOG_SENTINEL = '\u0000SIGX_LOG\u0000';

/** HTTP path the device streamer POSTs to. */
export const LOG_ENDPOINT_PATH = '/__sigx/logs';

const VALID_LEVELS = new Set(['log', 'info', 'warn', 'error', 'debug', 'trace']);

/** Server-side log entry (what the CLI receives after parsing the sentinel). */
export interface ServerLogEntry {
    level: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace';
    args: string[];
    ts: number;
    platform: string;
    /** Stable per-connection id assigned by the server. */
    client: number;
}

/**
 * Allocate a short, stable client id per remote address so the CLI can
 * distinguish concurrent devices in the terminal.
 */
function makeClientIdAllocator(): (req: IncomingMessage) => number {
    const ids = new Map<string, number>();
    let next = 1;
    return (req) => {
        const key = `${req.socket.remoteAddress ?? '?'}:${req.socket.remotePort ?? 0}`;
        let id = ids.get(key);
        if (id === undefined) {
            id = next++;
            ids.set(key, id);
        }
        return id;
    };
}

/**
 * Connect-style middleware that handles POST /__sigx/logs.
 * Other requests pass through via `next()`.
 *
 * `writeLine` is injected so tests can capture the sentinel output without
 * touching `process.stdout`.
 */
export function createLogMiddleware(
    writeLine: (line: string) => void = (line) => { process.stdout.write(line); },
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
    const allocClient = makeClientIdAllocator();

    return (req, res, next) => {
        if (req.method !== 'POST' || req.url !== LOG_ENDPOINT_PATH) {
            next();
            return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        const MAX_BODY = 1_000_000; // 1 MB hard cap per batch.
        let aborted = false;

        req.on('data', (chunk: Buffer) => {
            if (aborted) return;
            total += chunk.length;
            if (total > MAX_BODY) {
                aborted = true;
                res.statusCode = 413;
                res.end('payload too large');
                return;
            }
            chunks.push(chunk);
        });

        req.on('error', () => {
            if (!aborted) {
                aborted = true;
                res.statusCode = 400;
                res.end('bad request');
            }
        });

        req.on('end', () => {
            if (aborted) return;
            const body = Buffer.concat(chunks).toString('utf8');
            let parsed: unknown;
            try {
                parsed = JSON.parse(body);
            } catch {
                res.statusCode = 400;
                res.end('invalid json');
                return;
            }

            const entries = (parsed as { entries?: unknown }).entries;
            if (!Array.isArray(entries)) {
                res.statusCode = 400;
                res.end('missing entries');
                return;
            }

            const client = allocClient(req);
            for (const raw of entries) {
                const e = raw as Partial<ServerLogEntry>;
                if (!e || typeof e !== 'object') continue;
                if (typeof e.level !== 'string' || !VALID_LEVELS.has(e.level)) continue;
                if (!Array.isArray(e.args)) continue;

                const out: ServerLogEntry = {
                    level: e.level as ServerLogEntry['level'],
                    args: e.args.map((a) => (typeof a === 'string' ? a : String(a))),
                    ts: typeof e.ts === 'number' ? e.ts : Date.now(),
                    platform: typeof e.platform === 'string' ? e.platform : 'unknown',
                    client,
                };
                writeLine(`${LOG_SENTINEL}${JSON.stringify(out)}\n`);
            }

            res.statusCode = 204;
            res.end();
        });
    };
}
