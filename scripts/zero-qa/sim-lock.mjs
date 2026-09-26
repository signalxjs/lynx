#!/usr/bin/env node
/**
 * sim-lock — one owner for the single iOS simulator (#1141, epic #1140).
 *
 *   node scripts/zero-qa/sim-lock.mjs acquire [--holder <name>] [--force] [--stale-min <n>]
 *   node scripts/zero-qa/sim-lock.mjs release [--force]
 *   node scripts/zero-qa/sim-lock.mjs status
 *
 * The lock is a DIRECTORY (`mkdir` is atomic on every platform) under the
 * OS temp dir, with an `owner.json` recording who took it and when. A lock
 * older than `--stale-min` (default 120) may be taken over with `--force`;
 * a fresh one never is, so two agents cannot both believe they own the sim.
 *
 * Exit codes: 0 = ok (acquire got it / release freed it / status: free),
 * 1 = held by someone else (status prints the holder), 2 = usage error.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOCK_DIR = process.env.SIGX_SIM_LOCK_DIR ?? join(tmpdir(), 'sigx-ios-sim.lock');
const OWNER = join(LOCK_DIR, 'owner.json');

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return fallback;
    const value = process.argv[i + 1];
    return value === undefined || value.startsWith('--') ? true : value;
}

export function readOwner() {
    try {
        return JSON.parse(readFileSync(OWNER, 'utf8'));
    } catch {
        return null;
    }
}

function describe(owner) {
    if (!owner) return 'held (no owner record — a crashed acquire?)';
    const age = Math.round((Date.now() - Date.parse(owner.since)) / 60000);
    return `held by "${owner.holder}" (pid ${owner.pid}, parent ${owner.ppid ?? '?'} on ${owner.host}) since ${owner.since} — ${age} min ago`;
}

function ageMinutes(owner) {
    return owner ? (Date.now() - Date.parse(owner.since)) / 60000 : Infinity;
}

function tryMkdir() {
    try {
        mkdirSync(LOCK_DIR);
        return true;
    } catch (err) {
        if (err.code === 'EEXIST') return false;
        throw err;
    }
}

export function acquire({ holder, force = false, staleMin = 120 }) {
    if (!tryMkdir()) {
        const owner = readOwner();
        if (owner && owner.holder === holder) return { ok: true, owner, reentrant: true };
        if (!force || ageMinutes(owner) < staleMin) return { ok: false, owner };
        rmSync(LOCK_DIR, { recursive: true, force: true });
        if (!tryMkdir()) return { ok: false, owner: readOwner() };
    }
    // `pid` is the process that took the lock; the CLI exits right after,
    // so `ppid` (the shell or agent that ran it) is the one to look for
    // when judging whether a lock is stale.
    const owner = { holder, pid: process.pid, ppid: process.ppid, host: hostname(), since: new Date().toISOString() };
    writeFileSync(OWNER, JSON.stringify(owner, null, 2));
    return { ok: true, owner };
}

function main() {
    const cmd = process.argv[2];
    const holder = String(arg('holder', process.env.SIGX_SIM_HOLDER ?? `${userInfo().username}@${process.cwd()}`));
    if (cmd === 'acquire') {
        const res = acquire({ holder, force: !!arg('force', false), staleMin: Number(arg('stale-min', 120)) });
        if (res.ok) {
            console.log(`sim lock ${res.reentrant ? 'already held' : 'acquired'} by "${holder}" (${LOCK_DIR})`);
            return 0;
        }
        console.error(`sim lock ${describe(res.owner)}. Wait for it, or take a STALE lock over with --force (older than --stale-min, default 120).`);
        return 1;
    }
    if (cmd === 'release') {
        const owner = readOwner();
        if (owner && owner.holder !== holder && !arg('force', false)) {
            console.error(`sim lock ${describe(owner)} — not yours ("${holder}"); pass --force to release anyway.`);
            return 1;
        }
        rmSync(LOCK_DIR, { recursive: true, force: true });
        console.log('sim lock released');
        return 0;
    }
    if (cmd === 'status') {
        if (!existsSync(LOCK_DIR)) {
            console.log('sim lock free');
            return 0;
        }
        const owner = readOwner();
        console.log(`sim lock ${describe(owner)}`);
        return 1;
    }
    console.error('usage: sim-lock.mjs acquire|release|status [--holder <name>] [--force] [--stale-min <n>]');
    return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    process.exitCode = main();
}
