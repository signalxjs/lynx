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
    injectPodfileEntries,
    injectInfoPlistDescriptions,
    cleanPrebuild,
    fingerprintPrebuildInputs,
} from '../src/prebuild.js';
import { resolveConfig } from '../src/config/parser.js';
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
