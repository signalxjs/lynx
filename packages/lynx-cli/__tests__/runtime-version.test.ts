/**
 * The runtime-version fingerprint decides whether a published OTA update may
 * run on a given binary, so its stability properties ARE the feature:
 *  - deterministic for identical native inputs
 *  - UNCHANGED by anything JS-only (lockstep version bumps must not
 *    invalidate published updates)
 *  - changed by native source content, the linked-module set, and the
 *    pinned override.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { computeRuntimeVersion, lynxSdkVersionFromTemplates } from '../src/util/runtime-version';
import type { ModuleManifest } from '../src/manifest';

const tempDirs: string[] = [];

function makePackage(name: string, files: Record<string, string>): { dir: string; manifestPath: string } {
    const dir = mkdtempSync(join(tmpdir(), 'sigx-rtv-'));
    tempDirs.push(dir);
    for (const [rel, content] of Object.entries(files)) {
        const abs = join(dir, rel);
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, content);
    }
    return { dir, manifestPath: join(dir, 'signalx-module.json') };
}

function manifestFor(pkg: string, moduleClass: string): ModuleManifest {
    return {
        name: pkg.replace('@sigx/lynx-', ''),
        package: pkg,
        description: 'test module',
        platforms: ['android', 'ios'],
        android: { moduleClass, sourceDir: 'android' },
        ios: { moduleClass, sourceDir: 'ios' },
    };
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('computeRuntimeVersion', () => {
    it('is deterministic for identical inputs', () => {
        const pkg = makePackage('@sigx/lynx-foo', {
            'android/Foo.kt': 'class Foo',
            'ios/Foo.swift': 'class Foo {}',
        });
        const manifests = [manifestFor('@sigx/lynx-foo', 'com.sigx.foo.Foo')];
        const index = new Map([['@sigx/lynx-foo', pkg.manifestPath]]);

        const a = computeRuntimeVersion('android', manifests, index);
        const b = computeRuntimeVersion('android', manifests, index);
        expect(a).toBe(b);
        expect(a).toMatch(/^fp1-[0-9a-f]{16}$/);
    });

    it('ignores JS-only files (only native sourceDir content is hashed)', () => {
        const pkg = makePackage('@sigx/lynx-foo', {
            'android/Foo.kt': 'class Foo',
            'src/index.ts': 'export const v = 1;',
            'package.json': '{"version":"0.5.6"}',
        });
        const manifests = [manifestFor('@sigx/lynx-foo', 'com.sigx.foo.Foo')];
        const index = new Map([['@sigx/lynx-foo', pkg.manifestPath]]);
        const before = computeRuntimeVersion('android', manifests, index);

        // The lockstep-release scenario: JS + version churn, native untouched.
        writeFileSync(join(pkg.dir, 'src', 'index.ts'), 'export const v = 2;');
        writeFileSync(join(pkg.dir, 'package.json'), '{"version":"0.5.7"}');
        const after = computeRuntimeVersion('android', manifests, index);
        expect(after).toBe(before);
    });

    it('changes when native source content changes', () => {
        const pkg = makePackage('@sigx/lynx-foo', { 'android/Foo.kt': 'class Foo' });
        const manifests = [manifestFor('@sigx/lynx-foo', 'com.sigx.foo.Foo')];
        const index = new Map([['@sigx/lynx-foo', pkg.manifestPath]]);
        const before = computeRuntimeVersion('android', manifests, index);

        writeFileSync(join(pkg.dir, 'android', 'Foo.kt'), 'class Foo { fun changed() {} }');
        const after = computeRuntimeVersion('android', manifests, index);
        expect(after).not.toBe(before);
    });

    it('changes when a native module is added (the "needs new prebuild" case)', () => {
        const foo = makePackage('@sigx/lynx-foo', { 'android/Foo.kt': 'class Foo' });
        const bar = makePackage('@sigx/lynx-bar', { 'android/Bar.kt': 'class Bar' });
        const fooManifest = manifestFor('@sigx/lynx-foo', 'com.sigx.foo.Foo');
        const barManifest = manifestFor('@sigx/lynx-bar', 'com.sigx.bar.Bar');
        const index = new Map([
            ['@sigx/lynx-foo', foo.manifestPath],
            ['@sigx/lynx-bar', bar.manifestPath],
        ]);

        const without = computeRuntimeVersion('android', [fooManifest], index);
        const withBar = computeRuntimeVersion('android', [fooManifest, barManifest], index);
        expect(withBar).not.toBe(without);
    });

    it('is per-platform: an iOS-only source edit leaves Android unchanged', () => {
        const pkg = makePackage('@sigx/lynx-foo', {
            'android/Foo.kt': 'class Foo',
            'ios/Foo.swift': 'class Foo {}',
        });
        const manifests = [manifestFor('@sigx/lynx-foo', 'com.sigx.foo.Foo')];
        const index = new Map([['@sigx/lynx-foo', pkg.manifestPath]]);
        const androidBefore = computeRuntimeVersion('android', manifests, index);
        const iosBefore = computeRuntimeVersion('ios', manifests, index);

        writeFileSync(join(pkg.dir, 'ios', 'Foo.swift'), 'class Foo { func changed() {} }');
        expect(computeRuntimeVersion('android', manifests, index)).toBe(androidBefore);
        expect(computeRuntimeVersion('ios', manifests, index)).not.toBe(iosBefore);
    });

    it('excludes debug-only modules (dev client does not ship in release)', () => {
        const foo = makePackage('@sigx/lynx-foo', { 'android/Foo.kt': 'class Foo' });
        const dev = makePackage('@sigx/lynx-dev-client', { 'android/Dev.kt': 'class Dev' });
        const fooManifest = manifestFor('@sigx/lynx-foo', 'com.sigx.foo.Foo');
        const devManifest: ModuleManifest = {
            ...manifestFor('@sigx/lynx-dev-client', 'com.sigx.devclient.DevClientModule'),
            type: 'dev-client',
        };
        const index = new Map([
            ['@sigx/lynx-foo', foo.manifestPath],
            ['@sigx/lynx-dev-client', dev.manifestPath],
        ]);

        const without = computeRuntimeVersion('android', [fooManifest], index);
        const withDev = computeRuntimeVersion('android', [fooManifest, devManifest], index);
        expect(withDev).toBe(without);
    });

    it('returns the pinned override verbatim', () => {
        expect(computeRuntimeVersion('android', [], new Map(), '1.0.0')).toBe('1.0.0');
    });
});

describe('lynxSdkVersionFromTemplates', () => {
    it('finds the SDK pin in both platform templates', () => {
        expect(lynxSdkVersionFromTemplates('android')).toMatch(/^\d+\.\d+/);
        expect(lynxSdkVersionFromTemplates('ios')).toMatch(/^\d+\.\d+/);
    });
});
