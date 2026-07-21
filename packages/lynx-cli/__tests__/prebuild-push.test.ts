import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    scaffoldAndroid,
    scaffoldIos,
    injectGradlePlugins,
    copyGoogleServicesFile,
    writeIosEntitlements,
    applyIosEntitlementsBuildSettings,
} from '../src/prebuild.js';
import { linkAndroid } from '../src/autolink/android.js';
import { linkIos } from '../src/autolink/ios.js';
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

const FCM_SERVICE = {
    name: 'com.sigx.notifications.SigxFirebaseMessagingService',
    exported: false,
    actions: ['com.google.firebase.MESSAGING_EVENT'],
};

let testDir: string;

beforeEach(() => {
    testDir = join(tmpdir(), `sigx-push-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
});

// ── Android: gradlePlugins ────────────────────────────────────────────────

describe('linkAndroid — gradlePlugins aggregation', () => {
    const fcmModule: ModuleManifest = {
        name: 'Notifications',
        package: '@sigx/lynx-notifications',
        description: 'Push',
        platforms: ['android'],
        android: {
            moduleClass: 'com.sigx.notifications.NotificationsModule',
            gradlePlugins: [{ id: 'com.google.gms.google-services', version: '4.4.2' }],
        },
    };

    it('collects a module-declared Gradle plugin', () => {
        const result = linkAndroid(resolveConfig(TEST_CONFIG), [fcmModule]);
        expect(result.gradlePlugins).toEqual([
            { id: 'com.google.gms.google-services', version: '4.4.2' },
        ]);
    });

    it('de-dupes on id (first wins)', () => {
        const other: ModuleManifest = {
            name: 'Other',
            package: '@sigx/lynx-other',
            description: 'x',
            platforms: ['android'],
            android: {
                moduleClass: 'com.x.Other',
                gradlePlugins: [{ id: 'com.google.gms.google-services', version: '9.9.9' }],
            },
        };
        const result = linkAndroid(resolveConfig(TEST_CONFIG), [fcmModule, other]);
        expect(result.gradlePlugins).toEqual([
            { id: 'com.google.gms.google-services', version: '4.4.2' },
        ]);
    });

    it('is empty when no module declares a plugin', () => {
        const plain: ModuleManifest = {
            name: 'Plain',
            package: '@sigx/lynx-plain',
            description: 'x',
            platforms: ['android'],
            android: { moduleClass: 'com.x.Plain' },
        };
        expect(linkAndroid(resolveConfig(TEST_CONFIG), [plain]).gradlePlugins).toEqual([]);
    });
});

describe('injectGradlePlugins', () => {
    const gradlePath = () => join(testDir, 'android', 'app', 'build.gradle.kts');

    it('injects an id(...) version line into the plugins block', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);

        injectGradlePlugins(testDir, config, [
            { id: 'com.google.gms.google-services', version: '4.4.2' },
        ]);

        const gradle = readFileSync(gradlePath(), 'utf-8');
        expect(gradle).toContain('id("com.google.gms.google-services") version "4.4.2"');
        expect(gradle).not.toContain('{{GRADLE_PLUGINS}}');
    });

    it('writes a placeholder comment when no plugins are provided', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);

        injectGradlePlugins(testDir, config, []);

        const gradle = readFileSync(gradlePath(), 'utf-8');
        expect(gradle).toContain('no auto-linked Gradle plugins');
        expect(gradle).not.toContain('{{GRADLE_PLUGINS}}');
    });

    it('is idempotent on re-run (marker consumed)', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);

        const plugins = [{ id: 'com.google.gms.google-services', version: '4.4.2' }];
        injectGradlePlugins(testDir, config, plugins);
        const first = readFileSync(gradlePath(), 'utf-8');
        injectGradlePlugins(testDir, config, plugins);
        expect(readFileSync(gradlePath(), 'utf-8')).toBe(first);
    });

    it('rejects a crafted plugin id / version', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);

        expect(() => injectGradlePlugins(testDir, config, [
            { id: 'evil") ; System.exit(0); id("x', version: '1' },
        ])).toThrow(/Invalid Gradle plugin id/);

        scaffoldAndroid(testDir, config); // restore marker
        expect(() => injectGradlePlugins(testDir, config, [
            { id: 'com.example.plugin', version: '1.0" apply false; classpath("evil' },
        ])).toThrow(/Invalid Gradle plugin version/);
    });
});

describe('injectGradlePlugins — declared requirements (#618)', () => {
    const gradlePath = () => join(testDir, 'android', 'app', 'build.gradle.kts');
    const GOOGLE_SERVICES = {
        id: 'com.google.gms.google-services',
        version: '4.4.2',
        requires: 'android.googleServicesFile' as const,
    };

    const withGoogleServicesFile = () => {
        const src = join(testDir, 'firebase', 'google-services.json');
        mkdirSync(join(testDir, 'firebase'), { recursive: true });
        writeFileSync(src, '{"project_info":{"project_id":"demo"}}');
        return resolveConfig({
            ...TEST_CONFIG,
            android: { ...TEST_CONFIG.android, googleServicesFile: './firebase/google-services.json' },
        });
    };

    it('skips a plugin whose requirement is unmet — the build stays green without Firebase', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);

        injectGradlePlugins(testDir, config, [GOOGLE_SERVICES]);

        const gradle = readFileSync(gradlePath(), 'utf-8');
        expect(gradle).not.toContain('com.google.gms.google-services');
        // Marker still consumed, so the file is valid Kotlin either way.
        expect(gradle).not.toContain('{{GRADLE_PLUGINS}}');
        expect(gradle).toContain('no auto-linked Gradle plugins');
    });

    it('applies it once google-services.json is configured', () => {
        const config = withGoogleServicesFile();
        scaffoldAndroid(testDir, config);

        injectGradlePlugins(testDir, config, [GOOGLE_SERVICES]);

        expect(readFileSync(gradlePath(), 'utf-8'))
            .toContain('id("com.google.gms.google-services") version "4.4.2"');
    });

    it('keeps unconditional plugins when a conditional one is skipped', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);

        injectGradlePlugins(testDir, config, [
            GOOGLE_SERVICES,
            { id: 'com.example.plain', version: '1.0.0' },
        ]);

        const gradle = readFileSync(gradlePath(), 'utf-8');
        expect(gradle).toContain('id("com.example.plain") version "1.0.0"');
        expect(gradle).not.toContain('com.google.gms.google-services');
    });

    it('rejects an unknown requirement instead of silently dropping the plugin', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);

        expect(() => injectGradlePlugins(testDir, config, [
            // Cast: the point is a manifest that escaped the type system.
            { id: 'com.example.plugin', version: '1.0.0', requires: 'android.nonsense' as never },
        ])).toThrow(/unknown requirement/);
    });

    it('rejects a googleServicesFile that exists but is a directory', () => {
        // Otherwise it reads as "configured", the plugin is applied, and the
        // copy step fails later with a bare EISDIR.
        mkdirSync(join(testDir, 'firebase', 'google-services.json'), { recursive: true });
        const config = resolveConfig({
            ...TEST_CONFIG,
            android: { ...TEST_CONFIG.android, googleServicesFile: './firebase/google-services.json' },
        });
        scaffoldAndroid(testDir, config);
        expect(() => injectGradlePlugins(testDir, config, [GOOGLE_SERVICES]))
            .toThrow(/is not a file/);
    });

    it('surfaces a typo\'d googleServicesFile rather than skipping the plugin', () => {
        const config = resolveConfig({
            ...TEST_CONFIG,
            android: { ...TEST_CONFIG.android, googleServicesFile: './firebase/typo.json' },
        });
        scaffoldAndroid(testDir, config);
        expect(() => injectGradlePlugins(testDir, config, [GOOGLE_SERVICES]))
            .toThrow(/no file exists/);
    });

    it("the shipped notifications manifest declares the requirement", async () => {
        // The fix is only real if the manifest that caused #618 opts in.
        const manifest = JSON.parse(
            readFileSync(
                new URL('../../lynx-notifications/signalx-module.json', import.meta.url),
                'utf-8',
            ),
        ) as ModuleManifest;
        expect(manifest.android?.gradlePlugins).toEqual([
            { id: 'com.google.gms.google-services', version: '4.4.2', requires: 'android.googleServicesFile' },
        ]);
    });
});

// ── Android: google-services.json ─────────────────────────────────────────

describe('copyGoogleServicesFile', () => {
    const destPath = () => join(testDir, 'android', 'app', 'google-services.json');

    it('copies the configured file into android/app on prebuild', () => {
        const src = join(testDir, 'firebase', 'google-services.json');
        mkdirSync(join(testDir, 'firebase'), { recursive: true });
        writeFileSync(src, '{"project_info":{"project_id":"demo"}}');

        const config = resolveConfig({
            ...TEST_CONFIG,
            android: { ...TEST_CONFIG.android, googleServicesFile: './firebase/google-services.json' },
        });
        scaffoldAndroid(testDir, config);
        copyGoogleServicesFile(testDir, config, [FCM_SERVICE]);

        expect(existsSync(destPath())).toBe(true);
        expect(readFileSync(destPath(), 'utf-8')).toContain('demo');
    });

    it('throws when the configured file is missing', () => {
        const config = resolveConfig({
            ...TEST_CONFIG,
            android: { ...TEST_CONFIG.android, googleServicesFile: './firebase/missing.json' },
        });
        scaffoldAndroid(testDir, config);
        expect(() => copyGoogleServicesFile(testDir, config, [FCM_SERVICE]))
            .toThrow(/no file exists/);
    });

    it('is a no-op (no copy) when unset, even with an FCM service linked', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldAndroid(testDir, config);
        copyGoogleServicesFile(testDir, config, [FCM_SERVICE]);
        expect(existsSync(destPath())).toBe(false);
    });
});

// ── iOS: entitlements ─────────────────────────────────────────────────────

describe('linkIos — entitlements aggregation', () => {
    const pushModule: ModuleManifest = {
        name: 'Notifications',
        package: '@sigx/lynx-notifications',
        description: 'Push',
        platforms: ['ios'],
        ios: { moduleClass: 'NotificationsModule', entitlements: { 'aps-environment': 'development' } },
    };

    it('collects a module-declared entitlement', () => {
        const result = linkIos(resolveConfig(TEST_CONFIG), [pushModule]);
        expect(result.entitlements).toEqual({ 'aps-environment': 'development' });
    });

    it('lets app-level ios.entitlements win on key collision and merges module-only keys', () => {
        const config = resolveConfig({
            ...TEST_CONFIG,
            ios: {
                ...TEST_CONFIG.ios,
                entitlements: {
                    'aps-environment': 'production',
                    'keychain-access-groups': ['$(AppIdentifierPrefix)com.test.myapp'],
                },
            },
        });
        const result = linkIos(config, [pushModule]);
        expect(result.entitlements).toEqual({
            'aps-environment': 'production', // app wins
            'keychain-access-groups': ['$(AppIdentifierPrefix)com.test.myapp'],
        });
    });

    it('is empty when nothing declares entitlements', () => {
        expect(linkIos(resolveConfig(TEST_CONFIG), []).entitlements).toEqual({});
    });
});

describe('writeIosEntitlements', () => {
    const releaseFile = () => join(testDir, 'ios', 'TestApp', 'TestApp.entitlements');
    const debugFile = () => join(testDir, 'ios', 'TestApp', 'TestApp.debug.entitlements');

    it('emits production (release) / development (debug) for aps-environment', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        const wrote = writeIosEntitlements(testDir, config, { 'aps-environment': 'development' });
        expect(wrote).toBe(true);

        const release = readFileSync(releaseFile(), 'utf-8');
        const debug = readFileSync(debugFile(), 'utf-8');
        expect(release).toContain('<key>aps-environment</key>');
        expect(release).toContain('<string>production</string>');
        expect(debug).toContain('<string>development</string>');
        expect(debug).not.toContain('<string>production</string>');
    });

    it('writes non-aps keys identically to both files', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        writeIosEntitlements(testDir, config, {
            'aps-environment': 'development',
            'keychain-access-groups': ['$(AppIdentifierPrefix)com.test.myapp'],
        });

        for (const f of [releaseFile(), debugFile()]) {
            const content = readFileSync(f, 'utf-8');
            expect(content).toContain('<key>keychain-access-groups</key>');
            expect(content).toContain('<string>$(AppIdentifierPrefix)com.test.myapp</string>');
        }
    });

    it('returns false and writes nothing for an empty map', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        expect(writeIosEntitlements(testDir, config, {})).toBe(false);
        expect(existsSync(releaseFile())).toBe(false);
        expect(existsSync(debugFile())).toBe(false);
    });

    it('is idempotent on re-run', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        const ent = { 'aps-environment': 'development' };
        writeIosEntitlements(testDir, config, ent);
        const first = readFileSync(releaseFile(), 'utf-8');
        writeIosEntitlements(testDir, config, ent);
        expect(readFileSync(releaseFile(), 'utf-8')).toBe(first);
    });
});

describe('applyIosEntitlementsBuildSettings', () => {
    const pbxprojPath = () => join(testDir, 'ios', 'TestApp.xcodeproj', 'project.pbxproj');

    it('wires CODE_SIGN_ENTITLEMENTS per build configuration', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        applyIosEntitlementsBuildSettings(testDir, config, true);

        const pbx = readFileSync(pbxprojPath(), 'utf-8');
        expect(pbx).toContain('CODE_SIGN_ENTITLEMENTS = "TestApp/TestApp.entitlements";');
        expect(pbx).toContain('CODE_SIGN_ENTITLEMENTS = "TestApp/TestApp.debug.entitlements";');
    });

    it('leaves the pbxproj untouched when there are no entitlements', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);
        const before = readFileSync(pbxprojPath(), 'utf-8');

        applyIosEntitlementsBuildSettings(testDir, config, false);
        expect(readFileSync(pbxprojPath(), 'utf-8')).toBe(before);
        expect(before).not.toContain('CODE_SIGN_ENTITLEMENTS');
    });

    it('is idempotent across repeated runs', () => {
        const config = resolveConfig(TEST_CONFIG);
        scaffoldIos(testDir, config);

        applyIosEntitlementsBuildSettings(testDir, config, true);
        const once = readFileSync(pbxprojPath(), 'utf-8');
        applyIosEntitlementsBuildSettings(testDir, config, true);
        expect(readFileSync(pbxprojPath(), 'utf-8')).toBe(once);
    });
});
