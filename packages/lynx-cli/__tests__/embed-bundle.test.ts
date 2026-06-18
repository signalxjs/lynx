/**
 * `embedBundle` is the single path that bakes the built `dist/main.lynx.bundle`
 * into a generated native project — shared by `run:* --release` and
 * `prebuild --embed-bundle` (#521). Its contract:
 *  - copies the real bundle to the iOS / Android slot the production loader reads
 *  - is a no-op-but-truthful when the destination already matches
 *  - THROWS (never silently no-ops) when the bundle is missing or empty, since
 *    a silent skip would re-ship the 0-byte placeholder the bug is about.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { embedBundle, embeddedBundleDest } from '../src/util/embed-bundle.js';
import { resolveConfig } from '../src/config/parser.js';
import type { LynxConfig } from '../src/config/schema.js';

const TEST_CONFIG: LynxConfig = {
    name: 'TestApp',
    version: '1.0.0',
    modules: [],
    platforms: ['android', 'ios'],
    android: { applicationId: 'com.test.myapp' },
    ios: { bundleIdentifier: 'com.test.myapp' },
};

const config = resolveConfig(TEST_CONFIG);
const tempDirs: string[] = [];

function makeProject(bundleContents?: string): string {
    const cwd = mkdtempSync(join(tmpdir(), 'sigx-embed-'));
    tempDirs.push(cwd);
    if (bundleContents !== undefined) {
        const distDir = join(cwd, 'dist');
        mkdirSync(distDir, { recursive: true });
        writeFileSync(join(distDir, 'main.lynx.bundle'), bundleContents);
    }
    return cwd;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('embedBundle', () => {
    it('copies the built bundle into the iOS app source dir', () => {
        const cwd = makeProject('REAL_BUNDLE_BYTES');
        const changed = embedBundle({ cwd, config, platform: 'ios', log: () => {} });
        expect(changed).toBe(true);
        const dest = embeddedBundleDest(cwd, config, 'ios');
        expect(dest).toBe(join(cwd, 'ios', 'TestApp', 'main.lynx.bundle'));
        expect(readFileSync(dest, 'utf8')).toBe('REAL_BUNDLE_BYTES');
    });

    it('copies the built bundle into the Android assets dir (creating it)', () => {
        const cwd = makeProject('REAL_BUNDLE_BYTES');
        embedBundle({ cwd, config, platform: 'android', log: () => {} });
        const dest = embeddedBundleDest(cwd, config, 'android');
        expect(dest).toBe(join(cwd, 'android', 'app', 'src', 'main', 'assets', 'main.lynx.bundle'));
        expect(readFileSync(dest, 'utf8')).toBe('REAL_BUNDLE_BYTES');
    });

    it('overwrites an existing 0-byte iOS placeholder', () => {
        const cwd = makeProject('REAL_BUNDLE_BYTES');
        const dest = embeddedBundleDest(cwd, config, 'ios');
        mkdirSync(join(dest, '..'), { recursive: true });
        writeFileSync(dest, ''); // the placeholder prebuild seeds
        const changed = embedBundle({ cwd, config, platform: 'ios', log: () => {} });
        expect(changed).toBe(true);
        expect(readFileSync(dest, 'utf8')).toBe('REAL_BUNDLE_BYTES');
    });

    it('reports no change when the destination already matches', () => {
        const cwd = makeProject('REAL_BUNDLE_BYTES');
        embedBundle({ cwd, config, platform: 'ios', log: () => {} });
        const changed = embedBundle({ cwd, config, platform: 'ios', log: () => {} });
        expect(changed).toBe(false);
    });

    it('throws when the built bundle is missing', () => {
        const cwd = makeProject(); // no dist/main.lynx.bundle
        expect(() => embedBundle({ cwd, config, platform: 'ios', log: () => {} }))
            .toThrow(/sigx build/);
        expect(existsSync(embeddedBundleDest(cwd, config, 'ios'))).toBe(false);
    });

    it('throws when the built bundle is empty (0 bytes)', () => {
        const cwd = makeProject('');
        expect(() => embedBundle({ cwd, config, platform: 'android', log: () => {} }))
            .toThrow(/empty/);
    });
});
