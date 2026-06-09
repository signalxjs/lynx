/**
 * Single-server lock + stable-port bookkeeping for `sigx dev`.
 *
 * `sigx dev` should claim ONE stable port per project (default 8788) and keep
 * it across restarts, so an already-running app — whose dev-server URLs are
 * baked into the bundle at build time — can reconnect to the same address
 * instead of being stranded when a restart happens to land on a different port.
 *
 * We persist the running server's identity to
 * `<cwd>/node_modules/.cache/@sigx/lynx-cli/dev-server.json` (the conventional
 * Node tool-cache location, auto-gitignored via `node_modules/`, mirroring
 * `target-history.ts`). On the next start we consult it to decide whether the
 * desired port is reclaimable (the previous owner died) or genuinely occupied
 * (a live `sigx dev` for this project — refuse rather than silently fork a
 * second server on a different port).
 *
 * All reads/writes are best-effort: a missing or corrupt lock degrades to the
 * normal free-port probe and never crashes `sigx dev`.
 */

import { createServer } from 'node:net';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

const FILE_VERSION = 1;

export interface DevLock {
    version: typeof FILE_VERSION;
    /** PID of the `sigx dev` process that owns the port. */
    pid: number;
    /** Bundler HTTP port (e.g. 8788). */
    httpPort: number;
    /** Log/reload WS port (always `httpPort + 1`). */
    wsPort: number;
    /** Milliseconds since the unix epoch when the lock was written. */
    startedAt: number;
}

export function lockPath(cwd: string): string {
    return join(cwd, 'node_modules', '.cache', '@sigx', 'lynx-cli', 'dev-server.json');
}

function isDevLock(v: unknown): v is DevLock {
    if (!v || typeof v !== 'object') return false;
    const o = v as Record<string, unknown>;
    if (o.version !== FILE_VERSION) return false;
    // Reject NaN / 0 / out-of-range / mismatched values so a corrupt or
    // unusable lock degrades to `null` (→ normal free-port probe) instead of
    // making `sigx dev` try to bind port 0 or trust a bogus targetPort.
    if (!Number.isInteger(o.pid) || (o.pid as number) < 1) return false;
    if (!Number.isInteger(o.httpPort) || (o.httpPort as number) < 1 || (o.httpPort as number) > 65534) return false;
    // The log/reload WS server always binds httpPort + 1 — enforce it so a
    // tampered/legacy lock can't yield an inconsistent pair.
    if (o.wsPort !== (o.httpPort as number) + 1) return false;
    if (typeof o.startedAt !== 'number' || !Number.isFinite(o.startedAt)) return false;
    return true;
}

/** Read the lock, returning `null` on any missing/parse/shape/version failure. */
export function readDevLock(cwd: string): DevLock | null {
    try {
        const raw = readFileSync(lockPath(cwd), 'utf-8');
        const parsed = JSON.parse(raw) as unknown;
        return isDevLock(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export function writeDevLock(cwd: string, lock: DevLock): void {
    try {
        const path = lockPath(cwd);
        mkdirSync(dirname(path), { recursive: true });
        // Plain overwrite — the lock is best-effort. A process killed
        // mid-write leaves JSON that readDevLock treats as null, so atomicity
        // isn't worth the cross-platform headache (renameSync over an existing
        // destination is unreliable on Windows). Mirrors target-history.ts.
        writeFileSync(path, JSON.stringify(lock, null, 2), 'utf-8');
    } catch {
        // Best-effort: the lock is a reliability nicety, not load-bearing.
    }
}

export function clearDevLock(cwd: string): void {
    try {
        unlinkSync(lockPath(cwd));
    } catch {
        // Already gone / unwritable — nothing to do.
    }
}

/**
 * True if a process with `pid` is currently alive. Uses the signal-0 probe,
 * which checks for existence without delivering a signal. `EPERM` means the
 * process exists but is owned by another user (still alive); `ESRCH` means no
 * such process. Cross-platform (Windows supports `process.kill(pid, 0)`).
 */
export function isPidAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return (err as NodeJS.ErrnoException)?.code === 'EPERM';
    }
}

/**
 * Probe whether a TCP port is bindable on all interfaces. Mirrors the bind the
 * dev server itself performs, so `true` here means `sigx dev` can take it.
 *
 * Always resolves (never rejects/throws): an out-of-range or non-integer port
 * — e.g. a bad user-supplied `--port` — resolves `false` rather than crashing,
 * since `server.listen()` throws synchronously on such values.
 */
export function isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            resolve(false);
            return;
        }
        try {
            const srv = createServer();
            srv.unref();
            srv.once('error', () => resolve(false));
            srv.listen(port, '0.0.0.0', () => {
                srv.close(() => resolve(true));
            });
        } catch {
            resolve(false);
        }
    });
}

/**
 * True when both `port` (the bundler HTTP port) and `port + 1` (the device
 * log/reload WS port the plugin binds) are bindable. The dev server needs the
 * whole pair, so this is the real "can I take this port?" check.
 */
export async function isPortPairFree(port: number): Promise<boolean> {
    return (await isPortFree(port)) && (await isPortFree(port + 1));
}

/**
 * Wait for `port` to become free, probing it up to `attempts` times with
 * `intervalMs` between probes (so `attempts - 1` sleeps total). Used to
 * reclaim the stable port right after the previous owner is found dead — the
 * OS may take a moment to release the listening socket. Resolves `true` as
 * soon as the port frees, `false` if it never does within the budget.
 */
export async function waitForPortFree(
    port: number,
    attempts = 5,
    intervalMs = 200,
): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
        // eslint-disable-next-line no-await-in-loop
        if (await isPortFree(port)) return true;
        if (i < attempts - 1) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
    }
    return false;
}
