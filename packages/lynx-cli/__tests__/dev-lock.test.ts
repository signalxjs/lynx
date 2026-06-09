/**
 * Tests for the dev-server port lock (#349).
 *
 * Covers the lock round-trip + corruption handling, the pid-liveness probe,
 * and the port-free probe — the primitives `startDevServer` uses to keep a
 * stable port across restarts (reclaim a dead session, refuse a live one).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';

import {
    lockPath,
    readDevLock,
    writeDevLock,
    clearDevLock,
    isPidAlive,
    isPortFree,
    waitForPortFree,
    type DevLock,
} from '../src/dev-lock.js';

let cwd: string;

beforeEach(() => {
    cwd = join(tmpdir(), `sigx-dev-lock-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwd, { recursive: true });
});

afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
});

const sampleLock = (over: Partial<DevLock> = {}): DevLock => ({
    version: 1,
    pid: process.pid,
    httpPort: 8788,
    wsPort: 8789,
    startedAt: 1700000000000,
    ...over,
});

/** Open a real TCP listener and return its port + a closer. */
async function listen(): Promise<{ port: number; close: () => Promise<void> }> {
    const srv = createServer();
    await new Promise<void>((resolve) => srv.listen(0, '0.0.0.0', () => resolve()));
    const port = (srv.address() as AddressInfo).port;
    return {
        port,
        close: () => new Promise<void>((resolve) => srv.close(() => resolve())),
    };
}

describe('dev lock round-trip', () => {
    it('writes then reads back the same lock', () => {
        const lock = sampleLock();
        writeDevLock(cwd, lock);
        expect(existsSync(lockPath(cwd))).toBe(true);
        expect(readDevLock(cwd)).toEqual(lock);
    });

    it('clearDevLock removes the file (and is safe when already gone)', () => {
        writeDevLock(cwd, sampleLock());
        clearDevLock(cwd);
        expect(existsSync(lockPath(cwd))).toBe(false);
        expect(readDevLock(cwd)).toBeNull();
        // Idempotent — no throw on a missing file.
        expect(() => clearDevLock(cwd)).not.toThrow();
    });

    it('readDevLock returns null when no lock exists', () => {
        expect(readDevLock(cwd)).toBeNull();
    });

    it('readDevLock returns null on corrupt JSON', () => {
        mkdirSync(join(cwd, 'node_modules', '.cache', '@sigx', 'lynx-cli'), { recursive: true });
        writeFileSync(lockPath(cwd), '{not json', 'utf-8');
        expect(readDevLock(cwd)).toBeNull();
    });

    it('readDevLock returns null on wrong shape or version', () => {
        const dir = join(cwd, 'node_modules', '.cache', '@sigx', 'lynx-cli');
        mkdirSync(dir, { recursive: true });
        writeFileSync(lockPath(cwd), JSON.stringify({ version: 1, pid: 'x' }), 'utf-8');
        expect(readDevLock(cwd)).toBeNull();
        writeFileSync(lockPath(cwd), JSON.stringify(sampleLock({ version: 2 as 1 })), 'utf-8');
        expect(readDevLock(cwd)).toBeNull();
    });
});

describe('isPidAlive', () => {
    it('reports the current process as alive', () => {
        expect(isPidAlive(process.pid)).toBe(true);
    });

    it('rejects non-positive / non-integer pids', () => {
        expect(isPidAlive(0)).toBe(false);
        expect(isPidAlive(-1)).toBe(false);
        expect(isPidAlive(1.5)).toBe(false);
    });

    it('reports a non-existent pid as dead', () => {
        // 2^31-1 is far above any real pid on macOS/Linux/Windows → ESRCH.
        expect(isPidAlive(2147483647)).toBe(false);
    });
});

describe('isPortFree / waitForPortFree', () => {
    it('isPortFree is false for a bound port, true once released', async () => {
        const { port, close } = await listen();
        expect(await isPortFree(port)).toBe(false);
        await close();
        expect(await isPortFree(port)).toBe(true);
    });

    it('waitForPortFree resolves true quickly for a free port', async () => {
        const { port, close } = await listen();
        await close();
        expect(await waitForPortFree(port, 3, 10)).toBe(true);
    });

    it('isPortFree resolves false (no throw) for out-of-range / invalid ports', async () => {
        expect(await isPortFree(0)).toBe(false);
        expect(await isPortFree(70000)).toBe(false);
        expect(await isPortFree(Number.NaN)).toBe(false);
        expect(await isPortFree(-5)).toBe(false);
    });

    it('waitForPortFree resolves false when the port stays held', async () => {
        const { port, close } = await listen();
        try {
            expect(await waitForPortFree(port, 2, 10)).toBe(false);
        } finally {
            await close();
        }
    });
});
