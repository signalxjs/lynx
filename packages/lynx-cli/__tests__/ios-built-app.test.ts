/**
 * Regression tests for #178 — `run:ios` installing a stale .app from another
 * checkout's DerivedData.
 *
 * Two checkouts of the same app share the Xcode scheme name, so the old
 * `find ~/Library/Developer/Xcode/DerivedData -path "*<scheme>*…" | head -1`
 * could return the OTHER checkout's bundle. These tests lock in the fix:
 *   - `findBuiltApp` is deterministic path resolution inside THIS project's
 *     `ios/build` derived-data dir (no globbing, no shared state),
 *   - the fast-path identity check (`sameAppBinary`) only matches when the
 *     installed executable is byte-identical to the local build products.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findBuiltApp, iosDerivedDataPath } from '../src/device-detect';
import { appExecutableHash, sameAppBinary } from '../src/util/app-identity';

let cwd: string;

beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'sigx-ios-built-app-'));
});

afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
});

/** Create `<cwd>/ios/build/Build/Products/<productDir>/<App>.app` with a binary. */
function makeBuiltApp(root: string, productDir: string, appName: string, binary: string): string {
    const appDir = join(iosDerivedDataPath(root), 'Build', 'Products', productDir, `${appName}.app`);
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, appName), binary);
    return appDir;
}

describe('findBuiltApp (project-local derived data)', () => {
    it('resolves the .app inside this project\'s ios/build products dir', () => {
        const appDir = makeBuiltApp(cwd, 'Debug-iphonesimulator', 'MyApp', 'bin');
        expect(findBuiltApp(cwd, 'MyApp')).toBe(appDir);
        expect(findBuiltApp(cwd, 'MyApp', 'simulator', 'Debug')).toBe(appDir);
    });

    it('selects the products dir by target and configuration', () => {
        const device = makeBuiltApp(cwd, 'Release-iphoneos', 'MyApp', 'bin');
        expect(findBuiltApp(cwd, 'MyApp', 'device', 'Release')).toBe(device);
        // Same scheme, different SDK/config → not found, never a wrong match.
        expect(findBuiltApp(cwd, 'MyApp', 'simulator', 'Release')).toBeNull();
        expect(findBuiltApp(cwd, 'MyApp', 'device', 'Debug')).toBeNull();
    });

    it('returns null when nothing was built (no globbing fallback)', () => {
        expect(findBuiltApp(cwd, 'MyApp')).toBeNull();
    });

    it('never resolves another checkout\'s products for the same scheme', () => {
        const otherCheckout = mkdtempSync(join(tmpdir(), 'sigx-ios-other-'));
        try {
            makeBuiltApp(otherCheckout, 'Debug-iphonesimulator', 'MyApp', 'other');
            // This checkout never built → null, even though "MyApp.app" exists
            // elsewhere on the machine.
            expect(findBuiltApp(cwd, 'MyApp')).toBeNull();
        } finally {
            rmSync(otherCheckout, { recursive: true, force: true });
        }
    });
});

describe('sameAppBinary (fast-path identity check)', () => {
    it('matches when the installed executable is byte-identical', () => {
        const local = makeBuiltApp(cwd, 'Debug-iphonesimulator', 'MyApp', 'binary-v1');
        const installed = join(cwd, 'container', 'MyApp.app');
        mkdirSync(installed, { recursive: true });
        writeFileSync(join(installed, 'MyApp'), 'binary-v1');
        expect(sameAppBinary(installed, local)).toBe(true);
    });

    it('rejects a same-bundle-id install from another checkout (different binary)', () => {
        const local = makeBuiltApp(cwd, 'Debug-iphonesimulator', 'MyApp', 'binary-v1');
        const installed = join(cwd, 'container', 'MyApp.app');
        mkdirSync(installed, { recursive: true });
        writeFileSync(join(installed, 'MyApp'), 'binary-v2-from-other-checkout');
        expect(sameAppBinary(installed, local)).toBe(false);
    });

    it('treats a missing/unreadable executable as not matching', () => {
        const local = makeBuiltApp(cwd, 'Debug-iphonesimulator', 'MyApp', 'binary-v1');
        const empty = join(cwd, 'container', 'MyApp.app');
        mkdirSync(empty, { recursive: true }); // .app exists but has no binary
        expect(sameAppBinary(empty, local)).toBe(false);
        expect(sameAppBinary(local, empty)).toBe(false);
        expect(appExecutableHash(empty)).toBeNull();
    });

    it('derives the executable name from the .app basename', () => {
        const a = join(cwd, 'A', 'Cool App.app');
        mkdirSync(a, { recursive: true });
        writeFileSync(join(a, 'Cool App'), 'bin');
        expect(appExecutableHash(a)).not.toBeNull();
    });
});
