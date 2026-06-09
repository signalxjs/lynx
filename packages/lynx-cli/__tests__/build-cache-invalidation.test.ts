/**
 * Tests for #348 — caches must invalidate when installed dependency versions
 * change. The build fingerprints fold in the lockfile, and `--reset-cache`
 * wipes the caches that version-keying can't reach.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { findLockfile } from '../src/util/package-manager.js';
import { fingerprintAndroidBuild, fingerprintIosBuild } from '../src/util/build-fingerprint.js';
import { fingerprintPrebuildInputs } from '../src/prebuild.js';
import { resetBuildCaches } from '../src/util/reset-cache.js';

let dir: string;

beforeEach(() => {
    dir = join(tmpdir(), `sigx-cache-inv-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

const writePkg = () => writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app' }), 'utf-8');
const writeLock = (content: string) => writeFileSync(join(dir, 'pnpm-lock.yaml'), content, 'utf-8');

describe('findLockfile', () => {
    it('finds a lockfile in the same directory', () => {
        writeLock('lockfileVersion: 9');
        expect(findLockfile(dir)).toBe(join(dir, 'pnpm-lock.yaml'));
    });

    it('walks up to find a lockfile in an ancestor (monorepo layout)', () => {
        writeLock('lockfileVersion: 9');
        const nested = join(dir, 'examples', 'showcase');
        mkdirSync(nested, { recursive: true });
        expect(findLockfile(nested)).toBe(join(dir, 'pnpm-lock.yaml'));
    });

    it('returns null when no lockfile exists', () => {
        const nested = join(dir, 'a', 'b');
        mkdirSync(nested, { recursive: true });
        // tmpdir() ancestors shouldn't contain a JS lockfile.
        expect(findLockfile(nested)).toBeNull();
    });
});

describe('lockfile-keyed fingerprints (#348)', () => {
    it('fingerprintPrebuildInputs changes when the lockfile content changes', () => {
        writePkg();
        writeLock('versions:\n  "@sigx/lynx-camera": 0.5.0\n');
        const a = fingerprintPrebuildInputs(dir, { android: true, ios: true });
        writeLock('versions:\n  "@sigx/lynx-camera": 0.5.1\n');
        const b = fingerprintPrebuildInputs(dir, { android: true, ios: true });
        expect(a).not.toBe(b);
    });

    it('fingerprintAndroidBuild changes when the lockfile content changes', () => {
        writeLock('versions:\n  "@sigx/lynx-camera": 0.5.0\n');
        const a = fingerprintAndroidBuild(dir);
        writeLock('versions:\n  "@sigx/lynx-camera": 0.5.1\n');
        const b = fingerprintAndroidBuild(dir);
        expect(a).not.toBe(b);
    });

    it('fingerprintIosBuild changes when the lockfile content changes', () => {
        writeLock('versions:\n  "@sigx/lynx-camera": 0.5.0\n');
        const a = fingerprintIosBuild(dir, 'App', 'Debug');
        writeLock('versions:\n  "@sigx/lynx-camera": 0.5.1\n');
        const b = fingerprintIosBuild(dir, 'App', 'Debug');
        expect(a).not.toBe(b);
    });

    it('is stable across repeated calls with the same lockfile', () => {
        writePkg();
        writeLock('versions:\n  "@sigx/lynx-camera": 0.5.0\n');
        expect(fingerprintPrebuildInputs(dir, { android: true, ios: true }))
            .toBe(fingerprintPrebuildInputs(dir, { android: true, ios: true }));
        expect(fingerprintAndroidBuild(dir)).toBe(fingerprintAndroidBuild(dir));
    });
});

describe('resetBuildCaches', () => {
    it('removes build caches but preserves @sigx/lynx-cli state files', () => {
        const dist = join(dir, 'dist', '.rspeedy');
        const sigxCli = join(dir, 'node_modules', '.cache', '@sigx', 'lynx-cli');
        const rspackCache = join(dir, 'node_modules', '.cache', 'rspack');
        mkdirSync(dist, { recursive: true });
        mkdirSync(sigxCli, { recursive: true });
        mkdirSync(rspackCache, { recursive: true });
        writeFileSync(join(dist, 'x'), 'cache', 'utf-8');
        writeFileSync(join(sigxCli, 'android-debug.hash'), 'abc', 'utf-8');
        writeFileSync(join(sigxCli, 'dev-server.json'), '{"pid":1}', 'utf-8');
        writeFileSync(join(sigxCli, 'last-targets.json'), '{}', 'utf-8');
        writeFileSync(join(rspackCache, 'c'), 'x', 'utf-8');

        resetBuildCaches(dir);

        // Build caches gone.
        expect(existsSync(join(dir, 'dist'))).toBe(false);
        expect(existsSync(rspackCache)).toBe(false);
        expect(existsSync(join(sigxCli, 'android-debug.hash'))).toBe(false);
        // State files preserved (wiping the port lock would re-enable #350).
        expect(existsSync(join(sigxCli, 'dev-server.json'))).toBe(true);
        expect(existsSync(join(sigxCli, 'last-targets.json'))).toBe(true);
    });

    it('is a no-op (no throw) when the caches do not exist', () => {
        expect(() => resetBuildCaches(dir)).not.toThrow();
    });
});
