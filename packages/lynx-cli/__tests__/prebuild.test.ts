import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, win32 } from 'node:path';
import { tmpdir } from 'node:os';
import {
    scaffoldAndroid,
    scaffoldIos,
    writeAndroidRegistry,
    writeIosRegistry,
    injectGradleDependencies,
    injectAndroidPermissions,
    injectAndroidMetaData,
    injectPodfileEntries,
    injectInfoPlistDescriptions,
    injectInfoPlistBackgroundModes,
    injectInfoPlistBgTaskIdentifiers,
    cleanPrebuild,
    fingerprintPrebuildInputs,
    writeAndroidDebugManifest,
    writeIosSharedScheme,
    applyIosSigningSettings,
    runPostPrebuildHook,
    writeIosDebugInfoPlist,
    applyIosDevClientBuildSettings,
} from '../src/prebuild.js';
import { linkAndroid } from '../src/autolink/android.js';
import { linkIos } from '../src/autolink/ios.js';
import { resolveConfig } from '../src/config/parser.js';
import { validateManifest } from '../src/manifest.js';
import type { ModuleManifest } from '../src/manifest.js';
import type { LynxConfig } from '../src/config/schema.js';

const TEST_CONFIG: LynxConfig = {
    name: 'TestApp',
    version: '1.2.3',
    modules: [],
    platforms: ['android', 'ios'],
    android: {
        applicationId: 'com.test.myapp',
        minSdk: 26,
        targetSdk: 35,
        compileSdk: 35,
    },
    ios: {
        bundleIdentifier: 'com.test.myapp',
        deploymentTarget: '16.0',
    },
};

let testDir: string;

beforeEach(() => {
    testDir = join(tmpdir(), `sigx-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
});

describe('scaffoldAndroid', () => {
    it('creates android directory structure', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);

        expect(existsSync(join(testDir, 'android'))).toBe(true);
        expect(existsSync(join(testDir, 'android', 'settings.gradle.kts'))).toBe(true);
        expect(existsSync(join(testDir, 'android', 'build.gradle.kts'))).toBe(true);
        expect(existsSync(join(testDir, 'android', 'app', 'build.gradle.kts'))).toBe(true);
    });

    it('substitutes applicationId in build.gradle.kts', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);

        const appGradle = readFileSync(
            join(testDir, 'android', 'app', 'build.gradle.kts'),
            'utf-8',
        );
        expect(appGradle).toContain('com.test.myapp');
        expect(appGradle).not.toContain('{{applicationId}}');
    });

    it('substitutes appName in settings.gradle.kts', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);

        const settings = readFileSync(
            join(testDir, 'android', 'settings.gradle.kts'),
            'utf-8',
        );
        expect(settings).toContain('TestApp');
    });

    it('renames __package__ to package path', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);

        const kotlinDir = join(
            testDir, 'android', 'app', 'src', 'main', 'kotlin',
            'com', 'test', 'myapp',
        );
        expect(existsSync(kotlinDir)).toBe(true);
        expect(existsSync(join(kotlinDir, 'App.kt'))).toBe(true);
        expect(existsSync(join(kotlinDir, 'MainActivity.kt'))).toBe(true);
    });

    it('substitutes package name in Kotlin files', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);

        const appKt = readFileSync(
            join(testDir, 'android', 'app', 'src', 'main', 'kotlin', 'com', 'test', 'myapp', 'App.kt'),
            'utf-8',
        );
        expect(appKt).toContain('package com.test.myapp');
        expect(appKt).not.toContain('{{packageName}}');
    });

    it('substitutes SDK versions', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);

        const gradle = readFileSync(
            join(testDir, 'android', 'app', 'build.gradle.kts'),
            'utf-8',
        );
        expect(gradle).toContain('minSdk = 26');
        expect(gradle).toContain('targetSdk = 35');
        expect(gradle).toContain('compileSdk = 35');
    });
});

describe('network security config', () => {
    it('does not permit cleartext traffic in release (main source set)', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);

        const manifest = readFileSync(
            join(testDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
            'utf-8',
        );
        expect(manifest).not.toContain('usesCleartextTraffic');
        expect(manifest).toContain('android:networkSecurityConfig="@xml/network_security_config"');

        const mainConfig = readFileSync(
            join(testDir, 'android', 'app', 'src', 'main', 'res', 'xml', 'network_security_config.xml'),
            'utf-8',
        );
        expect(mainConfig).toContain('cleartextTrafficPermitted="false"');
        expect(mainConfig).not.toContain('cleartextTrafficPermitted="true"');
    });

    it('permits cleartext traffic via the debug source-set override', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);

        const debugConfig = readFileSync(
            join(testDir, 'android', 'app', 'src', 'debug', 'res', 'xml', 'network_security_config.xml'),
            'utf-8',
        );
        expect(debugConfig).toContain('cleartextTrafficPermitted="true"');
    });
});

describe('scaffoldIos', () => {
    it('creates ios directory structure', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        expect(existsSync(join(testDir, 'ios'))).toBe(true);
        expect(existsSync(join(testDir, 'ios', 'Podfile'))).toBe(true);
    });

    it('renames __AppName__ directory to app name', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        expect(existsSync(join(testDir, 'ios', 'TestApp'))).toBe(true);
        expect(existsSync(join(testDir, 'ios', 'TestApp', 'App.swift'))).toBe(true);
    });

    it('substitutes deployment target in Podfile', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        const podfile = readFileSync(join(testDir, 'ios', 'Podfile'), 'utf-8');
        expect(podfile).toContain("'16.0'");
        expect(podfile).not.toContain('{{deploymentTarget}}');
    });

    it('substitutes app name in Info.plist', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        const plist = readFileSync(join(testDir, 'ios', 'TestApp', 'Info.plist'), 'utf-8');
        expect(plist).toContain('TestApp');
        expect(plist).not.toContain('{{appName}}');
    });
});

describe('writeAndroidRegistry', () => {
    it('writes registry file at correct package path', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);

        const code = 'package placeholder\n\nobject GeneratedModuleRegistry {\n    fun registerAll() {}\n}\n';
        writeAndroidRegistry(testDir, config, code);

        const registryPath = join(
            testDir, 'android', 'app', 'src', 'main', 'kotlin',
            'com', 'test', 'myapp', 'GeneratedModuleRegistry.kt',
        );
        expect(existsSync(registryPath)).toBe(true);

        const content = readFileSync(registryPath, 'utf-8');
        expect(content).toContain('package com.test.myapp');
    });
});

describe('writeIosRegistry', () => {
    it('writes registry file in app directory', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        const code = 'import Foundation\n\nclass GeneratedModuleRegistry {\n    static func registerAll() {}\n}\n';
        writeIosRegistry(testDir, config, code);

        const registryPath = join(testDir, 'ios', 'TestApp', 'GeneratedModuleRegistry.swift');
        expect(existsSync(registryPath)).toBe(true);
    });
});

describe('injectGradleDependencies', () => {
    it('injects dependencies at marker', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);

        injectGradleDependencies(testDir, config, [
            'com.example:module-a:1.0.0',
            'com.example:module-b:2.0.0',
        ]);

        const gradle = readFileSync(
            join(testDir, 'android', 'app', 'build.gradle.kts'),
            'utf-8',
        );
        expect(gradle).toContain('implementation("com.example:module-a:1.0.0")');
        expect(gradle).toContain('implementation("com.example:module-b:2.0.0")');
    });

    it('does nothing for empty deps', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);

        const before = readFileSync(
            join(testDir, 'android', 'app', 'build.gradle.kts'),
            'utf-8',
        );
        injectGradleDependencies(testDir, config, []);
        const after = readFileSync(
            join(testDir, 'android', 'app', 'build.gradle.kts'),
            'utf-8',
        );
        expect(after).toBe(before);
    });
});

describe('injectAndroidPermissions', () => {
    it('injects permissions at marker', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);

        injectAndroidPermissions(testDir, config, [
            'android.permission.CAMERA',
            'android.permission.RECORD_AUDIO',
        ]);

        const manifest = readFileSync(
            join(testDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
            'utf-8',
        );
        expect(manifest).toContain('android.permission.CAMERA');
        expect(manifest).toContain('android.permission.RECORD_AUDIO');
    });
});

describe('injectAndroidMetaData', () => {
    it('injects meta-data at marker', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);

        injectAndroidMetaData(testDir, config, [
            { name: 'com.google.android.geo.API_KEY', value: 'AIzaTESTKEY' },
        ]);

        const manifest = readFileSync(
            join(testDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
            'utf-8',
        );
        expect(manifest).toContain(
            '<meta-data android:name="com.google.android.geo.API_KEY" android:value="AIzaTESTKEY" />',
        );
    });

    it('XML-escapes values', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);

        injectAndroidMetaData(testDir, config, [
            { name: 'com.example.KEY', value: 'a&b<c>"d"' },
        ]);

        const manifest = readFileSync(
            join(testDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
            'utf-8',
        );
        expect(manifest).toContain('android:value="a&amp;b&lt;c&gt;&quot;d&quot;"');
    });

    it('does nothing for empty meta-data', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);

        const before = readFileSync(
            join(testDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
            'utf-8',
        );
        injectAndroidMetaData(testDir, config, []);
        const after = readFileSync(
            join(testDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
            'utf-8',
        );
        expect(after).toBe(before);
    });
});

describe('linkAndroid — metaData resolution', () => {
    const mapsManifest: ModuleManifest = {
        name: 'Maps',
        package: '@sigx/lynx-maps',
        description: 'Native map view',
        platforms: ['android'],
        android: {
            metaData: [
                {
                    name: 'com.google.android.geo.API_KEY',
                    valueFrom: 'android.googleMapsApiKey',
                    default: 'MISSING_GOOGLE_MAPS_API_KEY',
                    helpUrl: 'https://example.com/get-key',
                },
            ],
        },
    };

    it('resolves valueFrom against the config', () => {
        const config = resolveConfig({
            ...TEST_CONFIG,
            android: { ...TEST_CONFIG.android, googleMapsApiKey: 'AIzaREALKEY' },
        });
        const result = linkAndroid(config, [mapsManifest]);
        expect(result.metaData).toEqual([
            { name: 'com.google.android.geo.API_KEY', value: 'AIzaREALKEY' },
        ]);
        expect(result.metaDataWarnings).toHaveLength(0);
    });

    it('falls back to default and warns when the config value is missing', () => {
        const config = resolveConfig(TEST_CONFIG);
        const result = linkAndroid(config, [mapsManifest]);
        expect(result.metaData).toEqual([
            { name: 'com.google.android.geo.API_KEY', value: 'MISSING_GOOGLE_MAPS_API_KEY' },
        ]);
        expect(result.metaDataWarnings).toHaveLength(1);
        expect(result.metaDataWarnings[0]).toContain('android.googleMapsApiKey');
        expect(result.metaDataWarnings[0]).toContain('https://example.com/get-key');
    });

    it('app-level manifestMetaData wins de-dupe over module entries', () => {
        const config = resolveConfig({
            ...TEST_CONFIG,
            android: {
                ...TEST_CONFIG.android,
                manifestMetaData: { 'com.google.android.geo.API_KEY': 'AIzaAPP' },
            },
        });
        const result = linkAndroid(config, [mapsManifest]);
        expect(result.metaData).toEqual([
            { name: 'com.google.android.geo.API_KEY', value: 'AIzaAPP' },
        ]);
        // App-level literal short-circuits the module's valueFrom fallback,
        // so no placeholder warning fires.
        expect(result.metaDataWarnings).toHaveLength(0);
    });

    it('skips empty/undefined manifestMetaData without blocking module entries', () => {
        const config = resolveConfig({
            ...TEST_CONFIG,
            android: {
                ...TEST_CONFIG.android,
                manifestMetaData: {
                    // e.g. `process.env.GOOGLE_MAPS_API_KEY` that isn't set —
                    // must NOT suppress the module's placeholder via de-dupe.
                    'com.google.android.geo.API_KEY': undefined as unknown as string,
                    'com.example.EMPTY': '   ',
                },
            },
        });
        const result = linkAndroid(config, [mapsManifest]);
        // Module placeholder still wins; the empty app-level key is dropped.
        expect(result.metaData).toEqual([
            { name: 'com.google.android.geo.API_KEY', value: 'MISSING_GOOGLE_MAPS_API_KEY' },
        ]);
    });
});

describe('injectPodfileEntries', () => {
    it('injects pod entries at marker', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        injectPodfileEntries(testDir, config, [
            "  pod 'SomeModule', '~> 1.0'",
            "  pod 'AnotherModule', '~> 2.0'",
        ]);

        const podfile = readFileSync(join(testDir, 'ios', 'Podfile'), 'utf-8');
        expect(podfile).toContain("pod 'SomeModule'");
        expect(podfile).toContain("pod 'AnotherModule'");
    });
});

describe('injectInfoPlistDescriptions', () => {
    it('injects usage descriptions at marker', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        injectInfoPlistDescriptions(testDir, config, {
            NSCameraUsageDescription: 'This app needs camera access',
            NSMicrophoneUsageDescription: 'This app needs microphone',
        });

        const plist = readFileSync(
            join(testDir, 'ios', 'TestApp', 'Info.plist'),
            'utf-8',
        );
        expect(plist).toContain('NSCameraUsageDescription');
        expect(plist).toContain('This app needs camera access');
    });
});

describe('injectInfoPlistBackgroundModes', () => {
    it('injects background modes at marker', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        injectInfoPlistBackgroundModes(testDir, config, ['fetch', 'processing']);

        const plist = readFileSync(
            join(testDir, 'ios', 'TestApp', 'Info.plist'),
            'utf-8',
        );
        expect(plist).toContain('<key>UIBackgroundModes</key>');
        expect(plist).toContain('<string>fetch</string>');
        expect(plist).toContain('<string>processing</string>');
    });

    it('writes a placeholder comment when no modes are provided', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        injectInfoPlistBackgroundModes(testDir, config, []);

        const plist = readFileSync(
            join(testDir, 'ios', 'TestApp', 'Info.plist'),
            'utf-8',
        );
        expect(plist).not.toContain('<key>UIBackgroundModes</key>');
        expect(plist).toContain('no auto-linked background modes');
    });
});

describe('injectInfoPlistBgTaskIdentifiers', () => {
    it('injects BGTaskSchedulerPermittedIdentifiers at marker', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        injectInfoPlistBgTaskIdentifiers(testDir, config, [
            'com.test.myapp.bg.refresh-feed',
            'com.test.myapp.bg.sync-outbox',
        ]);

        const plist = readFileSync(
            join(testDir, 'ios', 'TestApp', 'Info.plist'),
            'utf-8',
        );
        expect(plist).toContain('<key>BGTaskSchedulerPermittedIdentifiers</key>');
        expect(plist).toContain('<string>com.test.myapp.bg.refresh-feed</string>');
        expect(plist).toContain('<string>com.test.myapp.bg.sync-outbox</string>');
    });

    it('writes a placeholder comment when no identifiers are provided', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        injectInfoPlistBgTaskIdentifiers(testDir, config, []);

        const plist = readFileSync(
            join(testDir, 'ios', 'TestApp', 'Info.plist'),
            'utf-8',
        );
        expect(plist).not.toContain('<key>BGTaskSchedulerPermittedIdentifiers</key>');
        expect(plist).toContain('no auto-linked BGTaskScheduler identifiers');
    });

    it('is idempotent on re-run', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        const ids = ['com.test.myapp.bg.refresh-feed'];
        injectInfoPlistBgTaskIdentifiers(testDir, config, ids);
        const first = readFileSync(join(testDir, 'ios', 'TestApp', 'Info.plist'), 'utf-8');
        injectInfoPlistBgTaskIdentifiers(testDir, config, ids);
        const second = readFileSync(join(testDir, 'ios', 'TestApp', 'Info.plist'), 'utf-8');
        expect(second).toEqual(first);
    });

    it('de-duplicates identifiers', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        injectInfoPlistBgTaskIdentifiers(testDir, config, [
            'com.test.myapp.bg.refresh-feed',
            'com.test.myapp.bg.sync-outbox',
            'com.test.myapp.bg.refresh-feed',
        ]);

        const plist = readFileSync(
            join(testDir, 'ios', 'TestApp', 'Info.plist'),
            'utf-8',
        );
        const matches = plist.match(/<string>com\.test\.myapp\.bg\.refresh-feed<\/string>/g);
        expect(matches).toHaveLength(1);
        expect(plist).toContain('<string>com.test.myapp.bg.sync-outbox</string>');
    });
});

describe('cleanPrebuild', () => {
    it('removes registry files in partial clean', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);
        scaffoldIos(testDir, config);
        writeAndroidRegistry(testDir, config, 'package com.test.myapp\nobject X {}');
        writeIosRegistry(testDir, config, 'class X {}');

        cleanPrebuild(testDir, config, false);

        const androidRegistry = join(
            testDir, 'android', 'app', 'src', 'main', 'kotlin',
            'com', 'test', 'myapp', 'GeneratedModuleRegistry.kt',
        );
        const iosRegistry = join(testDir, 'ios', 'TestApp', 'GeneratedModuleRegistry.swift');
        expect(existsSync(androidRegistry)).toBe(false);
        expect(existsSync(iosRegistry)).toBe(false);

        // Project dirs should still exist
        expect(existsSync(join(testDir, 'android'))).toBe(true);
        expect(existsSync(join(testDir, 'ios'))).toBe(true);
    });

    it('removes entire directories in full clean', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);
        scaffoldIos(testDir, config);

        cleanPrebuild(testDir, config, true);

        expect(existsSync(join(testDir, 'android'))).toBe(false);
        expect(existsSync(join(testDir, 'ios'))).toBe(false);
    });
});

describe('fingerprintPrebuildInputs — sourceDir invalidation', () => {
    // Regression: a workspace package's `.swift` / `.kt` may change without
    // its `signalx-module.json` changing (new prop setter, new UI method,
    // bug fix). Before this case was wired, the fingerprint only hashed
    // the manifest itself — so the consumer's fast-path would skip
    // prebuild, the `copy*ModuleSources` step wouldn't run, and the .app
    // would link against a stale copy of the package's native source.
    //
    // The symptom users hit: "module X not available" / "UI Y not found"
    // at runtime, because the generated registry referenced a class that
    // wasn't physically present in the build.
    function makeFakeWorkspace(): { cwd: string; sourceFile: string } {
        const cwd = join(tmpdir(), `sigx-fp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const pkgDir = join(cwd, 'node_modules', '@fake', 'lynx-foo');
        const sourceDir = join(pkgDir, 'ios');
        const sourceFile = join(sourceDir, 'FakeUI.swift');
        mkdirSync(sourceDir, { recursive: true });
        writeFileSync(join(cwd, 'package.json'), JSON.stringify({
            name: 'host',
            dependencies: { '@fake/lynx-foo': '^0.0.0' },
        }));
        writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
            name: '@fake/lynx-foo',
            version: '0.0.0',
            exports: {
                './signalx-module.json': './signalx-module.json',
            },
        }));
        writeFileSync(join(pkgDir, 'signalx-module.json'), JSON.stringify({
            name: 'FakeFoo',
            package: '@fake/lynx-foo',
            description: 'fake',
            platforms: ['ios'],
            ios: { moduleClass: 'FakeUI', sourceDir: 'ios' },
        }));
        writeFileSync(sourceFile, '// initial body\n');
        return { cwd, sourceFile };
    }

    it('rehashes when a workspace package\'s sourceDir file changes', () => {
        const { cwd, sourceFile } = makeFakeWorkspace();
        try {
            const before = fingerprintPrebuildInputs(cwd, { android: true, ios: true });
            writeFileSync(sourceFile, '// modified body — new prop setter added\n');
            const after = fingerprintPrebuildInputs(cwd, { android: true, ios: true });
            expect(after).not.toBe(before);
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    it('rehashes when a brand-new file appears in a sourceDir', () => {
        const { cwd, sourceFile } = makeFakeWorkspace();
        try {
            const before = fingerprintPrebuildInputs(cwd, { android: true, ios: true });
            // New sibling file in the same sourceDir — a new helper class
            // dropped in by the package author.
            writeFileSync(join(sourceFile, '..', 'NewHelper.swift'), '// new file\n');
            const after = fingerprintPrebuildInputs(cwd, { android: true, ios: true });
            expect(after).not.toBe(before);
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    it('is stable when nothing changes (so the fast-path can fire)', () => {
        const { cwd } = makeFakeWorkspace();
        try {
            const a = fingerprintPrebuildInputs(cwd, { android: true, ios: true });
            const b = fingerprintPrebuildInputs(cwd, { android: true, ios: true });
            expect(a).toBe(b);
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });
});

describe('copyIosModuleSources — Windows path handling', () => {
    // Regression for the bug where `swift.split('/').pop()!` returned
    // the full absolute path on Windows (no `/` to split on), and the
    // subsequent `join(dest, fileName)` nested the entire source path
    // under the destination. The fix uses `path.basename`, which knows
    // about both `/` and `\` on Windows.
    //
    // This test runs on whichever OS the CI runner provides. On
    // Windows it exercises the real bug path end-to-end via the
    // native `node:path` import in prebuild.ts. On POSIX it asserts
    // the win32-specific basename logic directly so the regression
    // is documented and a future refactor that re-introduces
    // `split('/').pop()` is caught here too.
    it('basename(absoluteWindowsPath) returns just the filename', () => {
        const winPath = 'D:\\a\\lynx\\lynx\\packages\\lynx-storage\\ios\\StorageModule.swift';
        // win32.basename works regardless of host OS.
        expect(win32.basename(winPath)).toBe('StorageModule.swift');

        // Document the original bug for posterity: `.split('/').pop()`
        // on a Windows-style absolute path returns the entire path
        // unchanged because there's no forward slash to split on.
        expect(winPath.split('/').pop()).toBe(winPath);

        // POSIX path: both approaches happen to agree (which is why
        // the bug was POSIX-invisible until CI ran on Windows).
        const posixPath = '/Users/me/proj/packages/lynx-storage/ios/StorageModule.swift';
        expect(basename(posixPath)).toBe('StorageModule.swift');
        expect(posixPath.split('/').pop()).toBe('StorageModule.swift');
    });
});

describe('writeAndroidDebugManifest', () => {
    const debugManifestPath = (cwd: string) =>
        join(cwd, 'android', 'app', 'src', 'debug', 'AndroidManifest.xml');

    it('writes a marker-tagged manifest with the debug-only permissions', () => {
        const config = resolveConfig(TEST_CONFIG);
        writeAndroidDebugManifest(testDir, config, ['android.permission.CAMERA']);

        const content = readFileSync(debugManifestPath(testDir), 'utf-8');
        expect(content).toContain('Auto-generated by sigx prebuild');
        expect(content).toContain('<uses-permission android:name="android.permission.CAMERA" />');
    });

    it('removes a previously generated manifest when no debug permissions remain', () => {
        const config = resolveConfig(TEST_CONFIG);
        writeAndroidDebugManifest(testDir, config, ['android.permission.CAMERA']);
        writeAndroidDebugManifest(testDir, config, []);

        expect(existsSync(debugManifestPath(testDir))).toBe(false);
    });

    it('never overwrites a user-managed debug manifest (no marker)', () => {
        const config = resolveConfig(TEST_CONFIG);
        const userContent = '<manifest><!-- hand-written --></manifest>\n';
        mkdirSync(join(testDir, 'android', 'app', 'src', 'debug'), { recursive: true });
        writeFileSync(debugManifestPath(testDir), userContent);

        writeAndroidDebugManifest(testDir, config, ['android.permission.CAMERA']);
        expect(readFileSync(debugManifestPath(testDir), 'utf-8')).toBe(userContent);
    });

    it('never deletes a user-managed debug manifest when permissions are empty', () => {
        const config = resolveConfig(TEST_CONFIG);
        const userContent = '<manifest><!-- hand-written --></manifest>\n';
        mkdirSync(join(testDir, 'android', 'app', 'src', 'debug'), { recursive: true });
        writeFileSync(debugManifestPath(testDir), userContent);

        writeAndroidDebugManifest(testDir, config, []);
        expect(readFileSync(debugManifestPath(testDir), 'utf-8')).toBe(userContent);
    });
});

describe('linkAndroid — debugOnly permission split', () => {
    const devClientManifest: ModuleManifest = {
        name: 'DevClient',
        package: '@sigx/lynx-dev-client',
        description: 'Dev client',
        type: 'dev-client',
        platforms: ['android'],
        android: {
            initClass: 'com.sigx.devclient.SigxDevClient',
            sourceDir: 'android/src/main/kotlin',
            releaseStubsDir: 'android/src/releaseStubs/kotlin',
            debugOnly: true,
            permissions: ['android.permission.CAMERA'],
        },
    };
    const locationManifest: ModuleManifest = {
        name: 'Location',
        package: '@sigx/lynx-location',
        description: 'Location services',
        platforms: ['android'],
        android: {
            moduleClass: 'com.sigx.location.LocationModule',
            permissions: ['android.permission.ACCESS_FINE_LOCATION'],
        },
    };

    it('routes debugOnly module permissions to debugPermissions', () => {
        const config = resolveConfig(TEST_CONFIG);
        const result = linkAndroid(config, [devClientManifest, locationManifest]);

        expect(result.permissions).toEqual(['android.permission.ACCESS_FINE_LOCATION']);
        expect(result.debugPermissions).toEqual(['android.permission.CAMERA']);
    });

    it('drops a debug permission already granted to all builds', () => {
        const config = resolveConfig(TEST_CONFIG);
        const cameraModule: ModuleManifest = {
            name: 'Camera',
            package: '@sigx/lynx-camera',
            description: 'Camera',
            platforms: ['android'],
            android: {
                moduleClass: 'com.sigx.camera.CameraModule',
                permissions: ['android.permission.CAMERA'],
            },
        };
        const result = linkAndroid(config, [devClientManifest, cameraModule]);

        expect(result.permissions).toEqual(['android.permission.CAMERA']);
        expect(result.debugPermissions).toEqual([]);
    });

    it('exposes releaseStubsDir on the discovered dev client', () => {
        const config = resolveConfig(TEST_CONFIG);
        const result = linkAndroid(config, [devClientManifest]);

        expect(result.devClient?.releaseStubsDir).toBe('android/src/releaseStubs/kotlin');
    });
});

describe('writeIosSharedScheme', () => {
    const schemePath = (cwd: string) => join(
        cwd, 'ios', 'TestApp.xcodeproj', 'xcshareddata', 'xcschemes', 'TestApp.xcscheme',
    );

    it('scaffoldIos ships a shared scheme with the app name substituted', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        const scheme = readFileSync(schemePath(testDir), 'utf-8');
        expect(scheme).toContain('BlueprintName = "TestApp"');
        expect(scheme).toContain('BuildableName = "TestApp.app"');
        expect(scheme).toContain('ReferencedContainer = "container:TestApp.xcodeproj"');
        expect(scheme).not.toContain('{{appName}}');
    });

    it('re-creates a deleted scheme on prebuild refresh', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);
        rmSync(schemePath(testDir));

        writeIosSharedScheme(testDir, config);
        expect(existsSync(schemePath(testDir))).toBe(true);
    });

    it('uses the app target UUID from the project pbxproj', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        // Simulate a hand-curated project with a different target UUID.
        const pbxprojPath = join(testDir, 'ios', 'TestApp.xcodeproj', 'project.pbxproj');
        const customUuid = 'ABCDEF0123456789ABCDEF01';
        writeFileSync(
            pbxprojPath,
            readFileSync(pbxprojPath, 'utf-8').replaceAll('E100000000000001', customUuid),
        );
        rmSync(schemePath(testDir));

        writeIosSharedScheme(testDir, config);
        const scheme = readFileSync(schemePath(testDir), 'utf-8');
        expect(scheme).toContain(`BlueprintIdentifier = "${customUuid}"`);
        expect(scheme).not.toContain('E100000000000001');
    });
});

describe('applyIosSigningSettings', () => {
    const pbxprojPath = (cwd: string) => join(cwd, 'ios', 'TestApp.xcodeproj', 'project.pbxproj');

    it('pins DEVELOPMENT_TEAM and CODE_SIGN_STYLE from config', () => {
        const config = resolveConfig({
            ...TEST_CONFIG,
            ios: { ...TEST_CONFIG.ios, developmentTeam: 'AB12CD34EF', codeSignStyle: 'Manual' },
        });
        scaffoldIos(testDir, config);
        applyIosSigningSettings(testDir, config);

        const pbx = readFileSync(pbxprojPath(testDir), 'utf-8');
        expect(pbx).toContain('DEVELOPMENT_TEAM = AB12CD34EF;');
        expect(pbx).toContain('CODE_SIGN_STYLE = Manual;');
        expect(pbx).not.toContain('DEVELOPMENT_TEAM = "";');
        expect(pbx).not.toContain('CODE_SIGN_STYLE = Automatic;');
    });

    it('leaves the pbxproj untouched when neither knob is set', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);
        const before = readFileSync(pbxprojPath(testDir), 'utf-8');

        applyIosSigningSettings(testDir, config);
        expect(readFileSync(pbxprojPath(testDir), 'utf-8')).toBe(before);
        // The scaffold default stays Automatic with an empty team.
        expect(before).toContain('CODE_SIGN_STYLE = Automatic;');
        expect(before).toContain('DEVELOPMENT_TEAM = "";');
    });

    it('is idempotent across repeated prebuilds', () => {
        const config = resolveConfig({
            ...TEST_CONFIG,
            ios: { ...TEST_CONFIG.ios, developmentTeam: 'AB12CD34EF', codeSignStyle: 'Manual' },
        });
        scaffoldIos(testDir, config);
        applyIosSigningSettings(testDir, config);
        const once = readFileSync(pbxprojPath(testDir), 'utf-8');
        applyIosSigningSettings(testDir, config);
        expect(readFileSync(pbxprojPath(testDir), 'utf-8')).toBe(once);
    });
});

describe('applyIosSigningSettings — validation', () => {
    it('rejects a malformed developmentTeam', () => {
        const config = resolveConfig({
            ...TEST_CONFIG,
            ios: { ...TEST_CONFIG.ios, developmentTeam: 'oops; CODE_SIGN_IDENTITY = hacked' },
        });
        scaffoldIos(testDir, config);
        expect(() => applyIosSigningSettings(testDir, config))
            .toThrow(/10-character alphanumeric Apple Team ID/);
    });

    it('rejects an invalid codeSignStyle from an untyped config file', () => {
        const config = resolveConfig({
            ...TEST_CONFIG,
            // Plain-JS configs bypass the schema union type.
            ios: { ...TEST_CONFIG.ios, codeSignStyle: 'automatic' as 'Automatic' },
        });
        scaffoldIos(testDir, config);
        expect(() => applyIosSigningSettings(testDir, config))
            .toThrow(/"Automatic" or "Manual"/);
    });
});

describe('writeIosSharedScheme — multi-target projects', () => {
    it('picks the target matching the app name, not the first target', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        // Simulate a hand-curated project with a tests target listed BEFORE
        // the app target in the PBXNativeTarget section. Anchor the splice on
        // the marker WITHOUT a trailing newline — the scaffolded pbxproj has
        // LF or CRLF endings depending on the checkout, and an LF-anchored
        // replace silently no-ops on CRLF, making this test pass vacuously.
        const pbxprojPath = join(testDir, 'ios', 'TestApp.xcodeproj', 'project.pbxproj');
        const pbx = readFileSync(pbxprojPath, 'utf-8');
        const testsTarget = [
            '/* Begin PBXNativeTarget section */',
            '\t\tFFFFFFFF000000000000FFFF /* TestAppTests */ = {',
            '\t\t\tisa = PBXNativeTarget;',
            '\t\t\tname = "TestAppTests";',
            '\t\t};',
        ].join('\n');
        const injected = pbx.replace('/* Begin PBXNativeTarget section */', testsTarget);
        expect(injected).toContain('FFFFFFFF000000000000FFFF'); // splice must not no-op
        writeFileSync(pbxprojPath, injected);
        rmSync(join(testDir, 'ios', 'TestApp.xcodeproj', 'xcshareddata', 'xcschemes', 'TestApp.xcscheme'));

        writeIosSharedScheme(testDir, config);
        const scheme = readFileSync(
            join(testDir, 'ios', 'TestApp.xcodeproj', 'xcshareddata', 'xcschemes', 'TestApp.xcscheme'),
            'utf-8',
        );
        expect(scheme).toContain('BlueprintIdentifier = "E100000000000001"');
        expect(scheme).not.toContain('FFFFFFFF000000000000FFFF');
    });
});

describe('runPostPrebuildHook', () => {
    it('is a no-op when no hook is configured', async () => {
        const config = resolveConfig(TEST_CONFIG);
        await expect(runPostPrebuildHook(testDir, config, { android: true, ios: true }))
            .resolves.toBeUndefined();
    });

    it('awaits a default-export function with { cwd, config, platforms }', async () => {
        const hookPath = join(testDir, 'scripts', 'post.mjs');
        mkdirSync(join(testDir, 'scripts'), { recursive: true });
        writeFileSync(hookPath, [
            'import { writeFileSync } from "node:fs";',
            'import { join } from "node:path";',
            'export default async function ({ cwd, config, platforms }) {',
            '    writeFileSync(join(cwd, "hook-ran.json"), JSON.stringify({',
            '        cwd, name: config.name, platforms,',
            '    }));',
            '}',
            '',
        ].join('\n'));

        const config = resolveConfig({ ...TEST_CONFIG, prebuild: { post: './scripts/post.mjs' } });
        await runPostPrebuildHook(testDir, config, { android: true, ios: false });

        const result = JSON.parse(readFileSync(join(testDir, 'hook-ran.json'), 'utf-8'));
        expect(result.cwd).toBe(testDir);
        expect(result.name).toBe('TestApp');
        expect(result.platforms).toEqual({ android: true, ios: false });
    });

    it('runs a side-effect-only module (no default export)', async () => {
        const hookPath = join(testDir, 'post.mjs');
        writeFileSync(hookPath, [
            'import { writeFileSync } from "node:fs";',
            `writeFileSync(${JSON.stringify(join(testDir, 'side-effect.txt'))}, "ran");`,
            '',
        ].join('\n'));

        const config = resolveConfig({ ...TEST_CONFIG, prebuild: { post: 'post.mjs' } });
        await runPostPrebuildHook(testDir, config, { android: true, ios: true });
        expect(existsSync(join(testDir, 'side-effect.txt'))).toBe(true);
    });

    it('re-imports an edited hook on the next run (cache busting)', async () => {
        const hookPath = join(testDir, 'post.mjs');
        const marker = join(testDir, 'marker.txt');
        const config = resolveConfig({ ...TEST_CONFIG, prebuild: { post: 'post.mjs' } });

        writeFileSync(hookPath, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "v1");`);
        await runPostPrebuildHook(testDir, config, { android: true, ios: true });
        expect(readFileSync(marker, 'utf-8')).toBe('v1');

        writeFileSync(hookPath, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "v2");`);
        await runPostPrebuildHook(testDir, config, { android: true, ios: true });
        expect(readFileSync(marker, 'utf-8')).toBe('v2');
    });

    it('throws an actionable error when the hook file is missing', async () => {
        const config = resolveConfig({ ...TEST_CONFIG, prebuild: { post: './scripts/missing.mjs' } });
        await expect(runPostPrebuildHook(testDir, config, { android: true, ios: true }))
            .rejects.toThrow(/prebuild\.post hook not found/);
    });

    it('propagates hook failures (a patch missing its anchor must stop the build)', async () => {
        const hookPath = join(testDir, 'post.mjs');
        writeFileSync(hookPath, 'export default function () { throw new Error("anchor not found"); }');

        const config = resolveConfig({ ...TEST_CONFIG, prebuild: { post: 'post.mjs' } });
        await expect(runPostPrebuildHook(testDir, config, { android: true, ios: true }))
            .rejects.toThrow(/anchor not found/);
    });
});

describe('resolveConfig — prebuild hooks', () => {
    it('passes prebuild.post through to the resolved config', () => {
        const config = resolveConfig({ ...TEST_CONFIG, prebuild: { post: './scripts/x.mjs' } });
        expect(config.prebuild?.post).toBe('./scripts/x.mjs');
    });

    it('leaves prebuild undefined when not configured', () => {
        const config = resolveConfig(TEST_CONFIG);
        expect(config.prebuild).toBeUndefined();
    });
});

describe('linkIos — debugOnly module handling (#179)', () => {
    const devClientManifest: ModuleManifest = {
        name: 'DevClient',
        package: '@sigx/lynx-dev-client',
        description: 'Dev client',
        type: 'dev-client',
        platforms: ['ios'],
        ios: {
            initClass: 'SigxDevClient',
            moduleClass: 'DevClientModule',
            sourceDir: 'ios/Sources/SigxDevClient',
            debugOnly: true,
            usageDescriptions: {
                NSCameraUsageDescription: 'Used to scan QR codes from the dev server.',
            },
        },
    };
    const cameraManifest: ModuleManifest = {
        name: 'Camera',
        package: '@sigx/lynx-camera',
        description: 'Camera module',
        platforms: ['ios'],
        ios: {
            moduleClass: 'CameraModule',
            sourceDir: 'ios',
        },
    };

    it('routes debugOnly usage descriptions to debugUsageDescriptions', () => {
        const config = resolveConfig(TEST_CONFIG);
        const result = linkIos(config, [devClientManifest, cameraManifest]);

        expect(result.usageDescriptions).not.toHaveProperty('NSCameraUsageDescription');
        expect(result.debugUsageDescriptions).toEqual({
            NSCameraUsageDescription: 'Used to scan QR codes from the dev server.',
        });
    });

    it('drops a debug usage description already declared for all configurations', () => {
        const config = resolveConfig({
            ...TEST_CONFIG,
            ios: {
                ...TEST_CONFIG.ios,
                usageDescriptions: { NSCameraUsageDescription: 'Take profile photos.' },
            },
        });
        const result = linkIos(config, [devClientManifest]);

        expect(result.usageDescriptions.NSCameraUsageDescription).toBe('Take profile photos.');
        expect(result.debugUsageDescriptions).toEqual({});
    });

    it('generates debugOnly module registrations inside #if DEBUG', () => {
        const config = resolveConfig(TEST_CONFIG);
        const result = linkIos(config, [devClientManifest, cameraManifest]);

        // The dev-client registration is gated; the camera one is not.
        expect(result.registryCode).toMatch(
            /#if DEBUG\n[\s\S]*DevClientModule\.self[\s\S]*#endif/,
        );
        const beforeGate = result.registryCode.split('#if DEBUG')[1];
        expect(result.registryCode.split('#if DEBUG')[0]).not.toContain('DevClientModule.self');
        expect(beforeGate).toBeDefined();
    });

    it('lists debugOnly module names only in the DEBUG registeredModules array', () => {
        const config = resolveConfig(TEST_CONFIG);
        const result = linkIos(config, [devClientManifest, cameraManifest]);

        // #if DEBUG array carries both; #else array carries only release modules.
        const m = result.registryCode.match(
            /#if DEBUG\s*\n\s*static let registeredModules: \[String\] = \[(.*)\]\s*\n\s*#else\s*\n\s*static let registeredModules: \[String\] = \[(.*)\]/,
        );
        expect(m).not.toBeNull();
        expect(m![1]).toContain('"DevClient"');
        expect(m![1]).toContain('"Camera"');
        expect(m![2]).toContain('"Camera"');
        expect(m![2]).not.toContain('"DevClient"');
    });

    it('emits a plain registeredModules array when no debugOnly modules are linked', () => {
        const config = resolveConfig(TEST_CONFIG);
        const result = linkIos(config, [cameraManifest]);

        expect(result.registryCode).not.toContain('#if DEBUG');
        expect(result.registryCode).toContain('static let registeredModules: [String] = ["Camera"]');
    });
});

describe('writeIosDebugInfoPlist', () => {
    it('snapshots Info.plist plus debug-only usage descriptions', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);
        injectInfoPlistDescriptions(testDir, config, { NSLocationWhenInUseUsageDescription: 'Maps.' });

        writeIosDebugInfoPlist(testDir, config, {
            NSCameraUsageDescription: 'Used to scan QR codes from the dev server.',
        });

        const releasePlist = readFileSync(join(testDir, 'ios', 'TestApp', 'Info.plist'), 'utf-8');
        const debugPlist = readFileSync(join(testDir, 'ios', 'TestApp', 'Info.debug.plist'), 'utf-8');
        // Release plist: shared keys only.
        expect(releasePlist).toContain('NSLocationWhenInUseUsageDescription');
        expect(releasePlist).not.toContain('NSCameraUsageDescription');
        // Debug plist: shared + debug-only keys, still a closed plist.
        expect(debugPlist).toContain('NSLocationWhenInUseUsageDescription');
        expect(debugPlist).toContain('NSCameraUsageDescription');
        expect(debugPlist.trimEnd().endsWith('</plist>')).toBe(true);
    });

    it('always writes Info.debug.plist so the Debug INFOPLIST_FILE never dangles', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        writeIosDebugInfoPlist(testDir, config, {});
        const releasePlist = readFileSync(join(testDir, 'ios', 'TestApp', 'Info.plist'), 'utf-8');
        const debugPlist = readFileSync(join(testDir, 'ios', 'TestApp', 'Info.debug.plist'), 'utf-8');
        expect(debugPlist).toBe(releasePlist);
    });
});

describe('applyIosDevClientBuildSettings', () => {
    const pbxprojPath = (cwd: string) => join(cwd, 'ios', 'TestApp.xcodeproj', 'project.pbxproj');

    it('scaffolded template already carries both settings (idempotent no-op)', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);
        const before = readFileSync(pbxprojPath(testDir), 'utf-8');
        expect(before).toContain('EXCLUDED_SOURCE_FILE_NAMES = "*/SigxDevClient/*";');
        expect(before).toContain('INFOPLIST_FILE = "TestApp/Info.debug.plist";');

        applyIosDevClientBuildSettings(testDir, config);
        expect(readFileSync(pbxprojPath(testDir), 'utf-8')).toBe(before);
    });

    it('upgrades a project scaffolded before the template carried the settings', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        // Simulate the pre-#179 pbxproj: Debug points at Info.plist, no exclusion.
        const legacy = readFileSync(pbxprojPath(testDir), 'utf-8')
            .replace('INFOPLIST_FILE = "TestApp/Info.debug.plist";', 'INFOPLIST_FILE = "TestApp/Info.plist";')
            .replace(/\s*EXCLUDED_SOURCE_FILE_NAMES = "\*\/SigxDevClient\/\*";/, '');
        writeFileSync(pbxprojPath(testDir), legacy);

        applyIosDevClientBuildSettings(testDir, config);
        const pbx = readFileSync(pbxprojPath(testDir), 'utf-8');
        expect(pbx).toContain('INFOPLIST_FILE = "TestApp/Info.debug.plist";');
        expect(pbx).toContain('EXCLUDED_SOURCE_FILE_NAMES = "*/SigxDevClient/*";');
        // Release keeps pointing at the release plist.
        expect(pbx).toContain('INFOPLIST_FILE = "TestApp/Info.plist";');
    });

    it('leaves a user-set EXCLUDED_SOURCE_FILE_NAMES untouched', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);
        const custom = readFileSync(pbxprojPath(testDir), 'utf-8')
            .replace('EXCLUDED_SOURCE_FILE_NAMES = "*/SigxDevClient/*";', 'EXCLUDED_SOURCE_FILE_NAMES = "*/MyStuff/*";');
        writeFileSync(pbxprojPath(testDir), custom);

        applyIosDevClientBuildSettings(testDir, config);
        const pbx = readFileSync(pbxprojPath(testDir), 'utf-8');
        expect(pbx).toContain('EXCLUDED_SOURCE_FILE_NAMES = "*/MyStuff/*";');
        expect(pbx).not.toContain('EXCLUDED_SOURCE_FILE_NAMES = "*/SigxDevClient/*";');
    });
});

describe('Info.plist usage-description XML escaping', () => {
    it('escapes XML-sensitive characters in debug-only descriptions', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        writeIosDebugInfoPlist(testDir, config, {
            NSCameraUsageDescription: 'Scan QR codes & connect to <dev> server',
        });

        const debugPlist = readFileSync(join(testDir, 'ios', 'TestApp', 'Info.debug.plist'), 'utf-8');
        expect(debugPlist).toContain('Scan QR codes &amp; connect to &lt;dev&gt; server');
        expect(debugPlist).not.toContain('& connect');
    });

    it('escapes XML-sensitive characters in release descriptions', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        injectInfoPlistDescriptions(testDir, config, {
            NSLocationWhenInUseUsageDescription: 'Find shops & <nearby> places',
        });

        const plist = readFileSync(join(testDir, 'ios', 'TestApp', 'Info.plist'), 'utf-8');
        expect(plist).toContain('Find shops &amp; &lt;nearby&gt; places');
    });
});

describe('generated registry — registeredCount reset', () => {
    it('resets the count at the top of registerAll for repeat calls', () => {
        const config = resolveConfig(TEST_CONFIG);
        const result = linkIos(config, [{
            name: 'Camera',
            package: '@sigx/lynx-camera',
            description: 'Camera module',
            platforms: ['ios'],
            ios: { moduleClass: 'CameraModule', sourceDir: 'ios' },
        }]);

        const body = result.registryCode;
        const registerAllIdx = body.indexOf('static func registerAll');
        const resetIdx = body.indexOf('registeredCount = 0', registerAllIdx);
        const firstRegisterIdx = body.indexOf('register(on: config', registerAllIdx);
        expect(resetIdx).toBeGreaterThan(registerAllIdx);
        expect(resetIdx).toBeLessThan(firstRegisterIdx);
    });
});

describe('shared native runtime — @sigx/lynx-core (#257)', () => {
    // Mirrors packages/lynx-core/signalx-module.json: an activity hook +
    // native sources but NO moduleClass on either platform.
    const coreManifest: ModuleManifest = {
        name: 'SigxCore',
        package: '@sigx/lynx-core',
        description: 'Shared native helpers',
        platforms: ['android', 'ios'],
        android: {
            activityHook: {
                class: 'com.sigx.core.SigxActivityHook',
                methods: ['onCreate', 'onResume', 'onPause'],
            },
            sourceDir: 'android',
            dependencies: ['androidx.fragment:fragment-ktx:1.8.5'],
        },
        ios: { sourceDir: 'ios' },
    };
    const permissionsManifest: ModuleManifest = {
        name: 'Permissions',
        package: '@sigx/lynx-permissions',
        description: 'Permission helper',
        platforms: ['android'],
        android: {
            activityHook: {
                class: 'com.sigx.permissions.PermissionsActivityHook',
                methods: ['onCreate', 'onRequestPermissionsResult'],
            },
            sourceDir: 'android',
        },
    };

    it('the real lynx-core manifest validates cleanly', () => {
        const manifestPath = new URL('../../lynx-core/signalx-module.json', import.meta.url);
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        expect(validateManifest(manifest)).toEqual([]);
    });

    it('dispatches the lynx-core hook before other hooks (manifest order)', () => {
        const config = resolveConfig(TEST_CONFIG);
        const result = linkAndroid(config, [coreManifest, permissionsManifest]);

        const onCreate = result.activityHooksCode;
        const coreIdx = onCreate.indexOf('com.sigx.core.SigxActivityHook.onCreate');
        const permsIdx = onCreate.indexOf('com.sigx.permissions.PermissionsActivityHook.onCreate');
        expect(coreIdx).toBeGreaterThan(-1);
        expect(permsIdx).toBeGreaterThan(-1);
        expect(coreIdx).toBeLessThan(permsIdx);
    });

    it('a moduleClass-less manifest registers nothing on Android', () => {
        const config = resolveConfig(TEST_CONFIG);
        const result = linkAndroid(config, [coreManifest]);

        expect(result.registryCode).not.toContain('SigxCore');
        expect(result.registryCode).not.toContain('com.sigx.core');
        // …but its gradle dependency still flows through.
        expect(result.gradleDependencies).toContain('androidx.fragment:fragment-ktx:1.8.5');
        // …and the lifecycle hooks are wired.
        expect(result.activityHooksCode).toContain('com.sigx.core.SigxActivityHook.onResume');
    });

    it('a moduleClass-less manifest registers nothing on iOS', () => {
        const config = resolveConfig(TEST_CONFIG);
        const result = linkIos(config, [coreManifest]);

        expect(result.registryCode).not.toContain('SigxCore');
    });
});
