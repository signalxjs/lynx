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
import {
    embedBundle, embeddedBundleDest,
    collectAsyncAssets, embedAsyncAssets, asyncAssetsRoot,
} from '../src/util/embed-bundle.js';
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

function addAsyncChunk(cwd: string, rel: string, contents: string): void {
    const abs = join(cwd, 'dist', ...rel.split('/'));
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, contents);
}

/** Seed a pbxproj that already carries the LynxAssets folder reference. */
function seedIosPbxproj(cwd: string, content = '/* LynxAssets */'): void {
    const projDir = join(cwd, 'ios', 'TestApp.xcodeproj');
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, 'project.pbxproj'), content);
}

describe('collectAsyncAssets', () => {
    it('returns an empty list when dist has no async chunks', () => {
        const cwd = makeProject('BUNDLE');
        expect(collectAsyncAssets(cwd)).toEqual([]);
    });

    it('discovers async chunks with posix rel paths, sorted', () => {
        const cwd = makeProject('BUNDLE');
        addAsyncChunk(cwd, 'static/js/async/b.123.js', 'chunk-b');
        addAsyncChunk(cwd, 'static/js/async/a.456.js', 'chunk-a');
        addAsyncChunk(cwd, 'static/js/async/nested/c.789.js', 'chunk-c');
        const assets = collectAsyncAssets(cwd);
        expect(assets.map((a) => a.rel)).toEqual([
            'static/js/async/a.456.js',
            'static/js/async/b.123.js',
            'static/js/async/nested/c.789.js',
        ]);
        expect(assets[0]?.size).toBe('chunk-a'.length);
    });
});

describe('embedAsyncAssets', () => {
    it('mirrors chunks into Android assets preserving rel paths (via embedBundle)', () => {
        const cwd = makeProject('BUNDLE');
        addAsyncChunk(cwd, 'static/js/async/101.abc.js', 'chunk-101');
        embedBundle({ cwd, config, platform: 'android', log: () => {} });
        const dest = join(asyncAssetsRoot(cwd, config, 'android'), 'static', 'js', 'async', '101.abc.js');
        expect(readFileSync(dest, 'utf8')).toBe('chunk-101');
    });

    it('mirrors chunks into iOS LynxAssets/ when the pbxproj has the folder ref', () => {
        const cwd = makeProject('BUNDLE');
        addAsyncChunk(cwd, 'static/js/async/101.abc.js', 'chunk-101');
        seedIosPbxproj(cwd);
        embedBundle({ cwd, config, platform: 'ios', log: () => {} });
        const dest = join(cwd, 'ios', 'TestApp', 'LynxAssets', 'static', 'js', 'async', '101.abc.js');
        expect(readFileSync(dest, 'utf8')).toBe('chunk-101');
    });

    it('removes stale chunks from a previous build', () => {
        const cwd = makeProject('BUNDLE');
        addAsyncChunk(cwd, 'static/js/async/old.111.js', 'old');
        embedBundle({ cwd, config, platform: 'android', log: () => {} });
        rmSync(join(cwd, 'dist', 'static'), { recursive: true });
        addAsyncChunk(cwd, 'static/js/async/new.222.js', 'new');
        embedBundle({ cwd, config, platform: 'android', log: () => {} });
        const root = join(asyncAssetsRoot(cwd, config, 'android'), 'static', 'js', 'async');
        expect(existsSync(join(root, 'old.111.js'))).toBe(false);
        expect(readFileSync(join(root, 'new.222.js'), 'utf8')).toBe('new');
    });

    it('clears the embedded subtree when the new build has no async chunks', () => {
        const cwd = makeProject('BUNDLE');
        addAsyncChunk(cwd, 'static/js/async/old.111.js', 'old');
        embedBundle({ cwd, config, platform: 'android', log: () => {} });
        rmSync(join(cwd, 'dist', 'static'), { recursive: true });
        embedBundle({ cwd, config, platform: 'android', log: () => {} });
        expect(existsSync(join(asyncAssetsRoot(cwd, config, 'android'), 'static', 'js', 'async'))).toBe(false);
    });

    it('throws on iOS when chunks exist but the pbxproj lacks the LynxAssets folder ref', () => {
        const cwd = makeProject('BUNDLE');
        addAsyncChunk(cwd, 'static/js/async/101.abc.js', 'chunk-101');
        seedIosPbxproj(cwd, '/* no folder ref here */');
        expect(() => embedBundle({ cwd, config, platform: 'ios', log: () => {} }))
            .toThrow(/sigx prebuild/);
    });

    it('is a silent no-op when there are no chunks and no stale subtree', () => {
        const cwd = makeProject('BUNDLE');
        expect(embedAsyncAssets({ cwd, config, platform: 'android', log: () => {} })).toBe(0);
    });
});
