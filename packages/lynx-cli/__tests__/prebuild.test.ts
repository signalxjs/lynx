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
} from '../src/prebuild.js';
import { linkAndroid } from '../src/autolink/android.js';
import { resolveConfig } from '../src/config/parser.js';
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
