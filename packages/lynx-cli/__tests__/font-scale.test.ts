import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffoldAndroid, scaffoldIos } from '../src/prebuild.js';
import { linkAndroid } from '../src/autolink/android.js';
import { linkIos } from '../src/autolink/ios.js';
import { resolveConfig } from '../src/config/parser.js';
import { validateManifest, publisherClasses } from '../src/manifest.js';
import type { ModuleManifest } from '../src/manifest.js';
import type { LynxConfig } from '../src/config/schema.js';

const TEST_CONFIG: LynxConfig = {
    name: 'TestApp',
    version: '1.2.3',
    modules: [],
    platforms: ['android', 'ios'],
    android: { applicationId: 'com.test.myapp' },
    ios: { bundleIdentifier: 'com.test.myapp' },
};

describe('resolveConfig — fontScale', () => {
    it('applies defaults when unset', () => {
        expect(resolveConfig(TEST_CONFIG).fontScale).toEqual({ follow: true, min: 0.5, max: 2.0 });
    });

    it('merges partial overrides onto defaults', () => {
        const resolved = resolveConfig({ ...TEST_CONFIG, fontScale: { max: 3.2 } });
        expect(resolved.fontScale).toEqual({ follow: true, min: 0.5, max: 3.2 });
    });

    it('accepts follow: false', () => {
        expect(resolveConfig({ ...TEST_CONFIG, fontScale: { follow: false } }).fontScale.follow).toBe(false);
    });

    it('rejects min > max', () => {
        expect(() => resolveConfig({ ...TEST_CONFIG, fontScale: { min: 2, max: 1.5 } }))
            .toThrow(/fontScale\.min .* must be <= fontScale\.max/);
    });

    it('rejects non-positive and non-finite bounds', () => {
        expect(() => resolveConfig({ ...TEST_CONFIG, fontScale: { min: 0 } })).toThrow(/fontScale\.min/);
        expect(() => resolveConfig({ ...TEST_CONFIG, fontScale: { max: Number.NaN } })).toThrow(/fontScale\.max/);
    });

    it('rejects a non-boolean follow', () => {
        expect(() => resolveConfig({
            ...TEST_CONFIG,
            fontScale: { follow: 'yes' as unknown as boolean },
        })).toThrow(/fontScale\.follow/);
    });
});

describe('manifest publisherClass — string | string[]', () => {
    const base: Record<string, unknown> = {
        name: 'TestModule',
        package: '@sigx/lynx-test',
        description: 'test',
        platforms: ['android'],
    };

    it('accepts a single string', () => {
        expect(validateManifest({ ...base, android: { publisherClass: 'com.x.P', sourceDir: 'android' } })).toEqual([]);
    });

    it('accepts an array of strings', () => {
        expect(validateManifest({
            ...base,
            android: { publisherClass: ['com.x.P', 'com.x.Q'], sourceDir: 'android' },
        })).toEqual([]);
    });

    it('rejects an empty array and non-string entries', () => {
        expect(validateManifest({ ...base, android: { publisherClass: [] } })).not.toEqual([]);
        expect(validateManifest({ ...base, android: { publisherClass: ['com.x.P', 42] } })).not.toEqual([]);
        expect(validateManifest({ ...base, android: { publisherClass: '' } })).not.toEqual([]);
    });

    it('publisherClasses normalizes string / array / undefined and de-dupes', () => {
        expect(publisherClasses(undefined)).toEqual([]);
        expect(publisherClasses('A')).toEqual(['A']);
        expect(publisherClasses(['A', 'B'])).toEqual(['A', 'B']);
        // A repeated class would double-attach and double-subscribe.
        expect(publisherClasses(['A', 'B', 'A'])).toEqual(['A', 'B']);
    });
});

describe('autolink — multiple publishers per manifest', () => {
    const coreLike: ModuleManifest = {
        name: 'SigxCore',
        package: '@sigx/lynx-core',
        description: 'core',
        platforms: ['android', 'ios'],
        android: {
            publisherClass: ['com.sigx.core.AppStatePublisher', 'com.sigx.core.FontScalePublisher'],
            sourceDir: 'android',
        },
        ios: {
            publisherClass: ['AppStatePublisher', 'FontScalePublisher'],
            sourceDir: 'ios',
        },
    };

    it('Android lifecycle code attaches every declared publisher', () => {
        const result = linkAndroid(resolveConfig(TEST_CONFIG), [coreLike]);
        expect(result.lifecycleCode).toContain('import com.sigx.core.AppStatePublisher');
        expect(result.lifecycleCode).toContain('import com.sigx.core.FontScalePublisher');
        expect(result.lifecycleCode).toContain('AppStatePublisher(lynxView).also { it.attach() }');
        expect(result.lifecycleCode).toContain('FontScalePublisher(lynxView).also { it.attach() }');
        expect(result.linkedLifecyclePublishers).toEqual(['SigxCore']);
    });

    it('iOS lifecycle code attaches every declared publisher', () => {
        const result = linkIos(resolveConfig(TEST_CONFIG), [coreLike]);
        expect(result.lifecycleCode).toContain('AppStatePublisher(lynxView: lynxView)');
        expect(result.lifecycleCode).toContain('FontScalePublisher(lynxView: lynxView)');
        expect(result.linkedLifecyclePublishers).toEqual(['SigxCore']);
    });

    it('single-string publisherClass keeps working', () => {
        const single: ModuleManifest = {
            ...coreLike,
            android: { publisherClass: 'com.sigx.core.AppStatePublisher', sourceDir: 'android' },
        };
        const result = linkAndroid(resolveConfig(TEST_CONFIG), [single]);
        expect(result.lifecycleCode).toContain('AppStatePublisher(lynxView).also { it.attach() }');
    });
});

describe('scaffold — font-scale stamping', () => {
    let testDir: string;

    beforeEach(() => {
        testDir = join(tmpdir(), `sigx-fs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('stamps the Android policy + builder seeds and manifest configChanges', () => {
        scaffoldAndroid(testDir, resolveConfig({ ...TEST_CONFIG, fontScale: { max: 1.5 } }));

        const mainActivity = readFileSync(
            join(testDir, 'android', 'app', 'src', 'main', 'kotlin', 'com', 'test', 'myapp', 'MainActivity.kt'),
            'utf-8',
        );
        expect(mainActivity).toContain('SigxFontScalePolicy(');
        expect(mainActivity).toContain('follow = true');
        expect(mainActivity).toContain('min = 0.5f');
        expect(mainActivity).toContain('max = 1.5f');
        expect(mainActivity).not.toContain('{{fontScale');
        // Both builder sites (production factory + dev-client lambda) seed.
        expect(mainActivity.match(/setFontScale\(/g)?.length).toBe(2);

        const manifest = readFileSync(
            join(testDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
            'utf-8',
        );
        expect(manifest).toContain('android:configChanges="fontScale"');
    });

    it('stamps the iOS policy and builder seed', () => {
        scaffoldIos(testDir, resolveConfig({ ...TEST_CONFIG, fontScale: { follow: false } }));

        const setup = readFileSync(
            join(testDir, 'ios', 'TestApp', 'Services', 'LynxSetupService.swift'),
            'utf-8',
        );
        expect(setup).toContain('SigxFontScalePolicy(');
        expect(setup).toContain('follow: false');
        expect(setup).toContain('min: 0.5');
        // Integer bounds gain a .0 so the stamped literal stays floating-point.
        expect(setup).toContain('max: 2.0');
        expect(setup).not.toContain('{{fontScale');

        const contentView = readFileSync(
            join(testDir, 'ios', 'TestApp', 'ContentView.swift'),
            'utf-8',
        );
        expect(contentView).toContain('builder.fontScale = SigxFontScale.effectiveScale()');
        expect(contentView).not.toContain('builder.fontScale = 1.0');
    });

    it('stamps high-precision bounds without truncation', () => {
        scaffoldAndroid(testDir, resolveConfig({ ...TEST_CONFIG, fontScale: { min: 0.875, max: 3.175 } }));

        const mainActivity = readFileSync(
            join(testDir, 'android', 'app', 'src', 'main', 'kotlin', 'com', 'test', 'myapp', 'MainActivity.kt'),
            'utf-8',
        );
        expect(mainActivity).toContain('min = 0.875f');
        expect(mainActivity).toContain('max = 3.175f');
    });
});
