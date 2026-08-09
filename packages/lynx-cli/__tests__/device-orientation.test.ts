import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    scaffoldAndroid,
    scaffoldIos,
    injectAndroidFeatures,
    applyIosDeviceFamily,
} from '../src/prebuild.js';
import { applyIosPlistMeta, applyAndroidManifestMeta } from '../src/assets/manifest.js';
import { linkAndroid } from '../src/autolink/android.js';
import { resolveConfig, resolveAssets } from '../src/config/parser.js';
import type { ModuleManifest } from '../src/manifest.js';
import type { LynxConfig } from '../src/config/schema.js';

const BASE_CONFIG: LynxConfig = {
    name: 'TestApp',
    android: { applicationId: 'com.test.myapp' },
    ios: { bundleIdentifier: 'com.test.myapp' },
};

let testDir: string;

beforeEach(() => {
    testDir = join(tmpdir(), `sigx-device-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
});

function plistAfter(raw: LynxConfig): string {
    const config = resolveConfig(raw);
    scaffoldIos(testDir, config);
    const assets = resolveAssets(raw, testDir);
    applyIosPlistMeta(testDir, config, assets.ios);
    return readFileSync(join(testDir, 'ios', 'TestApp', 'Info.plist'), 'utf-8');
}

/** The `~ipad` orientation block, or null when the key is absent. */
function ipadBlock(plist: string): string | null {
    const m = plist.match(/<key>UISupportedInterfaceOrientations~ipad<\/key>\s*<array>([\s\S]*?)<\/array>/);
    return m ? m[1] : null;
}

/** The phone orientation block. */
function phoneBlock(plist: string): string {
    const m = plist.match(/<key>UISupportedInterfaceOrientations<\/key>\s*<array>([\s\S]*?)<\/array>/);
    return m![1];
}

// ────────────────────────────────────────────────────────────────
// iOS orientations + iPad policy
// ────────────────────────────────────────────────────────────────

describe('applyIosPlistMeta — orientations & device support', () => {
    it('portrait lock on iPhone, all four on iPad by default (multitasking rules)', () => {
        const plist = plistAfter({ ...BASE_CONFIG, orientation: 'portrait' });
        expect(phoneBlock(plist)).toContain('UIInterfaceOrientationPortrait');
        expect(phoneBlock(plist)).not.toContain('Landscape');
        const ipad = ipadBlock(plist);
        expect(ipad).not.toBeNull();
        expect(ipad).toContain('UIInterfaceOrientationPortraitUpsideDown');
        expect(ipad).toContain('UIInterfaceOrientationLandscapeLeft');
        expect(plist).not.toContain('UIRequiresFullScreen');
    });

    it('requiresFullScreen locks the iPad to the phone orientation and emits the key', () => {
        const plist = plistAfter({
            ...BASE_CONFIG,
            orientation: 'portrait',
            ios: { ...BASE_CONFIG.ios, requiresFullScreen: true },
        });
        const ipad = ipadBlock(plist);
        expect(ipad).not.toBeNull();
        expect(ipad).toContain('UIInterfaceOrientationPortrait');
        expect(ipad).not.toContain('Landscape');
        expect(plist).toContain('<key>UIRequiresFullScreen</key>');
    });

    it('supportsTablet: false omits the ~ipad key', () => {
        const plist = plistAfter({
            ...BASE_CONFIG,
            ios: { ...BASE_CONFIG.ios, supportsTablet: false },
        });
        expect(ipadBlock(plist)).toBeNull();
    });

    it("orientation 'all' lists all four orientations on the phone key", () => {
        const plist = plistAfter({ ...BASE_CONFIG, orientation: 'all' });
        const phone = phoneBlock(plist);
        expect(phone).toContain('UIInterfaceOrientationPortrait');
        expect(phone).toContain('UIInterfaceOrientationPortraitUpsideDown');
        expect(phone).toContain('UIInterfaceOrientationLandscapeLeft');
        expect(phone).toContain('UIInterfaceOrientationLandscapeRight');
    });

    it("orientation 'default' keeps the legacy portrait + landscapes set (regression)", () => {
        const plist = plistAfter({ ...BASE_CONFIG, orientation: 'default' });
        const phone = phoneBlock(plist);
        expect(phone).toContain('UIInterfaceOrientationPortrait');
        expect(phone).not.toContain('UIInterfaceOrientationPortraitUpsideDown');
        expect(phone).toContain('UIInterfaceOrientationLandscapeLeft');
    });
});

// ────────────────────────────────────────────────────────────────
// iOS device family (pbxproj)
// ────────────────────────────────────────────────────────────────

describe('applyIosDeviceFamily', () => {
    const pbxprojPath = () => join(testDir, 'ios', 'TestApp.xcodeproj', 'project.pbxproj');

    it('rewrites TARGETED_DEVICE_FAMILY to "1" when supportsTablet is false', () => {
        const config = resolveConfig({ ...BASE_CONFIG, ios: { ...BASE_CONFIG.ios, supportsTablet: false } });
        scaffoldIos(testDir, config);
        applyIosDeviceFamily(testDir, config);

        const pbxproj = readFileSync(pbxprojPath(), 'utf-8');
        expect(pbxproj).toContain('TARGETED_DEVICE_FAMILY = "1";');
        expect(pbxproj).not.toContain('TARGETED_DEVICE_FAMILY = "1,2";');
    });

    it('keeps "1,2" by default and is idempotent', () => {
        const config = resolveConfig(BASE_CONFIG);
        scaffoldIos(testDir, config);
        applyIosDeviceFamily(testDir, config);
        expect(readFileSync(pbxprojPath(), 'utf-8')).toContain('TARGETED_DEVICE_FAMILY = "1,2";');

        const before = statSync(pbxprojPath()).mtimeMs;
        applyIosDeviceFamily(testDir, config);
        expect(statSync(pbxprojPath()).mtimeMs).toBe(before);
    });

    it('flips back to "1,2" when supportsTablet is re-enabled', () => {
        const iphoneOnly = resolveConfig({ ...BASE_CONFIG, ios: { ...BASE_CONFIG.ios, supportsTablet: false } });
        scaffoldIos(testDir, iphoneOnly);
        applyIosDeviceFamily(testDir, iphoneOnly);

        const universal = resolveConfig(BASE_CONFIG);
        applyIosDeviceFamily(testDir, universal);
        expect(readFileSync(pbxprojPath(), 'utf-8')).toContain('TARGETED_DEVICE_FAMILY = "1,2";');
    });
});

// ────────────────────────────────────────────────────────────────
// iOS runtime-lock ceiling (#856)
// ────────────────────────────────────────────────────────────────

describe('scaffoldIos — AppDelegate orientation mask', () => {
    function appSwiftAfter(raw: LynxConfig): string {
        scaffoldIos(testDir, resolveConfig(raw));
        return readFileSync(join(testDir, 'ios', 'TestApp', 'App.swift'), 'utf-8');
    }

    // Implementing `supportedInterfaceOrientationsFor` OVERRIDES Info.plist,
    // so the stamped default has to mirror what applyIosPlistMeta writes —
    // otherwise the runtime ceiling and the declared set disagree. Tablets are
    // supported by default, so the phone mask rides an idiom branch.
    it.each([
        ['portrait', '.portrait'],
        ['landscape', '.landscape'],
        ['all', '.all'],
        ['default', '.allButUpsideDown'],
    ] as const)('stamps orientation %s as the phone arm of the idiom branch', (orientation, mask) => {
        const app = appSwiftAfter({ ...BASE_CONFIG, orientation });
        expect(app).toContain(
            `SigxOrientation.supportedMask(default: (UIDevice.current.userInterfaceIdiom == .pad ? .all : ${mask}))`,
        );
        expect(app).not.toContain('{{orientationDefaultMask}}');
    });

    // A multitasking-capable iPad app must support all four orientations (App
    // Store validation) — applyIosPlistMeta writes that into the `~ipad` key,
    // and the AppDelegate mask has to agree or the runtime clamps the iPad to
    // the phone lock regardless.
    it('gives the iPad all four orientations under a phone portrait lock', () => {
        const app = appSwiftAfter({ ...BASE_CONFIG, orientation: 'portrait' });
        expect(app).toContain('UIDevice.current.userInterfaceIdiom == .pad ? .all : .portrait');
    });

    it('lets requiresFullScreen collapse the iPad onto the phone mask', () => {
        const app = appSwiftAfter({
            ...BASE_CONFIG,
            orientation: 'portrait',
            ios: { ...BASE_CONFIG.ios, requiresFullScreen: true },
        });
        expect(app).toContain('SigxOrientation.supportedMask(default: .portrait)');
        expect(app).not.toContain('userInterfaceIdiom');
    });

    it('emits no idiom branch when the app does not support tablets', () => {
        const app = appSwiftAfter({
            ...BASE_CONFIG,
            orientation: 'landscape',
            ios: { ...BASE_CONFIG.ios, supportsTablet: false },
        });
        expect(app).toContain('SigxOrientation.supportedMask(default: .landscape)');
        expect(app).not.toContain('userInterfaceIdiom');
    });

    it('honors the iOS-only orientation override', () => {
        const app = appSwiftAfter({
            ...BASE_CONFIG,
            orientation: 'portrait',
            ios: { ...BASE_CONFIG.ios, orientation: 'all' },
        });
        expect(app).toContain('userInterfaceIdiom == .pad ? .all : .all');
    });
});

// ────────────────────────────────────────────────────────────────
// Android orientation
// ────────────────────────────────────────────────────────────────

describe('applyAndroidManifestMeta — orientation', () => {
    function manifestAfter(raw: LynxConfig): string {
        const config = resolveConfig(raw);
        scaffoldAndroid(testDir, config);
        const assets = resolveAssets(raw, testDir);
        applyAndroidManifestMeta(testDir, config, assets.android);
        return readFileSync(join(testDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf-8');
    }

    it("renders 'all' as fullSensor", () => {
        expect(manifestAfter({ ...BASE_CONFIG, orientation: 'all' }))
            .toContain('android:screenOrientation="fullSensor"');
    });

    it("renders 'default' as unspecified (regression)", () => {
        expect(manifestAfter({ ...BASE_CONFIG, orientation: 'default' }))
            .toContain('android:screenOrientation="unspecified"');
    });

    it('handles rotation in place instead of recreating the Activity (#856)', () => {
        const manifest = manifestAfter({ ...BASE_CONFIG, orientation: 'default' });
        const configChanges = manifest.match(/android:configChanges="([^"]+)"/)![1].split('|');
        // Without orientation|screenSize a rotation recreates the Activity and
        // reloads the bundle, losing all app state.
        expect(configChanges).toContain('orientation');
        expect(configChanges).toContain('screenSize');
        // Foldables / multi-window resize.
        expect(configChanges).toContain('smallestScreenSize');
        expect(configChanges).toContain('screenLayout');
        // #766 must survive.
        expect(configChanges).toContain('fontScale');
        // Dark-mode flips switch in place since #986 —
        // AppearancePublisher republishes both channels on the
        // application-level configuration callback.
        expect(configChanges).toContain('uiMode');
    });
});

// ────────────────────────────────────────────────────────────────
// Android uses-feature
// ────────────────────────────────────────────────────────────────

describe('injectAndroidFeatures', () => {
    const manifestPath = () => join(testDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

    it('injects uses-feature entries with required defaulting to false', () => {
        const config = resolveConfig(BASE_CONFIG);
        scaffoldAndroid(testDir, config);
        injectAndroidFeatures(testDir, config, [
            { name: 'android.hardware.camera' },
            { name: 'android.hardware.location.gps', required: true },
        ]);

        const manifest = readFileSync(manifestPath(), 'utf-8');
        expect(manifest).toContain('<uses-feature android:name="android.hardware.camera" android:required="false" />');
        expect(manifest).toContain('<uses-feature android:name="android.hardware.location.gps" android:required="true" />');
        expect(manifest).not.toContain('{{FEATURES}}');
    });

    it('is a no-op for an empty list (marker left for later injection)', () => {
        const config = resolveConfig(BASE_CONFIG);
        scaffoldAndroid(testDir, config);
        injectAndroidFeatures(testDir, config, []);
        expect(readFileSync(manifestPath(), 'utf-8')).toContain('<!-- {{FEATURES}} -->');
    });

    it('XML-escapes feature names', () => {
        const config = resolveConfig(BASE_CONFIG);
        scaffoldAndroid(testDir, config);
        injectAndroidFeatures(testDir, config, [{ name: 'a"b<c>&d' }]);
        const manifest = readFileSync(manifestPath(), 'utf-8');
        expect(manifest).toContain('android:name="a&quot;b&lt;c&gt;&amp;d"');
    });
});

describe('linkAndroid — features aggregation', () => {
    const cameraManifest: ModuleManifest = {
        name: 'Camera',
        package: '@sigx/lynx-camera',
        description: 'Photo/video capture',
        platforms: ['android'],
        android: {
            permissions: ['android.permission.CAMERA'],
            features: [{ name: 'android.hardware.camera', required: false }],
        },
    };

    it('aggregates module features', () => {
        const config = resolveConfig(BASE_CONFIG);
        const result = linkAndroid(config, [cameraManifest]);
        expect(result.features).toEqual([{ name: 'android.hardware.camera', required: false }]);
    });

    it('app-level features win the de-dupe over module entries', () => {
        const config = resolveConfig({
            ...BASE_CONFIG,
            android: {
                ...BASE_CONFIG.android,
                features: [{ name: 'android.hardware.camera', required: true }],
            },
        });
        const result = linkAndroid(config, [cameraManifest]);
        expect(result.features).toEqual([{ name: 'android.hardware.camera', required: true }]);
    });

    it('de-dupes repeated names within the app config (first wins)', () => {
        const config = resolveConfig({
            ...BASE_CONFIG,
            android: {
                ...BASE_CONFIG.android,
                features: [
                    { name: 'android.hardware.camera', required: false },
                    { name: 'android.hardware.camera', required: true },
                ],
            },
        });
        const result = linkAndroid(config, []);
        expect(result.features).toEqual([{ name: 'android.hardware.camera', required: false }]);
    });

    it('de-dupes the same feature across modules (first wins)', () => {
        const other: ModuleManifest = {
            ...cameraManifest,
            name: 'Scanner',
            package: '@sigx/lynx-scanner',
        };
        const config = resolveConfig(BASE_CONFIG);
        const result = linkAndroid(config, [cameraManifest, other]);
        expect(result.features).toHaveLength(1);
    });
});
