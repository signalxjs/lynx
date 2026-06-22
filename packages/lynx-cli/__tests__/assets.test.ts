import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import {
    generateIosIcon,
    generateAndroidAdaptiveIcon,
    generateAndroidNotificationIcon,
} from '../src/assets/icons.js';
import { generateIosSplash, generateAndroidSplash } from '../src/assets/splash.js';
import { applyAndroidManifestMeta } from '../src/assets/manifest.js';
import { scaffoldAndroid } from '../src/prebuild.js';
import { resolveConfig, resolveAssets } from '../src/config/parser.js';
import type { LynxConfig } from '../src/config/schema.js';

const BASE_CONFIG: LynxConfig = {
    name: 'TestApp',
    android: { applicationId: 'com.test.myapp' },
    ios: { bundleIdentifier: 'com.test.myapp' },
};

let testDir: string;

/** Write a tiny solid-color PNG fixture and return its project-relative name. */
async function writePng(name: string, color = { r: 255, g: 0, b: 0, alpha: 1 }): Promise<string> {
    const buf = await sharp({ create: { width: 64, height: 64, channels: 4, background: color } })
        .png()
        .toBuffer();
    writeFileSync(join(testDir, name), buf);
    return name;
}

beforeEach(() => {
    testDir = join(tmpdir(), `sigx-assets-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
});

// ────────────────────────────────────────────────────────────────
// Config resolution
// ────────────────────────────────────────────────────────────────

describe('resolveAssets', () => {
    it('defaults: no variants, center resize mode, no dark splash', () => {
        const assets = resolveAssets(BASE_CONFIG, testDir);
        expect(assets.ios.iconDark).toBeNull();
        expect(assets.ios.iconTinted).toBeNull();
        expect(assets.ios.splashResizeMode).toBe('center');
        expect(assets.ios.splashDark).toBeNull();
        expect(assets.android.splashDark).toBeNull();
        expect(assets.android.notificationIcon).toBeNull();
        expect(assets.android.notificationColor).toBeNull();
        expect(assets.android.adaptiveIcon).toBeNull();
    });

    it('resolves ios.icon string as light-only', () => {
        const assets = resolveAssets({ ...BASE_CONFIG, ios: { icon: 'assets/ios.png' } }, testDir);
        expect(assets.ios.iconSource).toBe(join(testDir, 'assets', 'ios.png'));
        expect(assets.ios.iconDark).toBeNull();
        expect(assets.ios.iconTinted).toBeNull();
    });

    it('treats ios.icon: null as unset (plain-JS config)', () => {
        const assets = resolveAssets(
            { ...BASE_CONFIG, icon: 'top.png', ios: { icon: null as unknown as string } },
            testDir,
        );
        expect(assets.ios.iconSource).toBe(join(testDir, 'top.png'));
        expect(assets.ios.iconDark).toBeNull();
        expect(assets.ios.iconTinted).toBeNull();
    });

    it('resolves ios.icon object with dark/tinted variants', () => {
        const assets = resolveAssets(
            { ...BASE_CONFIG, ios: { icon: { light: 'l.png', dark: 'd.png', tinted: 't.png' } } },
            testDir,
        );
        expect(assets.ios.iconSource).toBe(join(testDir, 'l.png'));
        expect(assets.ios.iconDark).toBe(join(testDir, 'd.png'));
        expect(assets.ios.iconTinted).toBe(join(testDir, 't.png'));
    });

    it('defaults ios icon background to white, overridable via ios.icon.background', () => {
        expect(resolveAssets(BASE_CONFIG, testDir).ios.iconBackground).toBe('#FFFFFF');
        expect(resolveAssets({ ...BASE_CONFIG, ios: { icon: 'a.png' } }, testDir).ios.iconBackground).toBe('#FFFFFF');
        const custom = resolveAssets(
            { ...BASE_CONFIG, ios: { icon: { light: 'l.png', background: '#0D9488' } } },
            testDir,
        );
        expect(custom.ios.iconBackground).toBe('#0D9488');
    });

    it('resolves adaptive icon monochrome (opt-in)', () => {
        const without = resolveAssets(
            { ...BASE_CONFIG, android: { adaptiveIcon: { foreground: 'fg.png' } } },
            testDir,
        );
        expect(without.android.adaptiveIcon?.monochrome).toBeNull();

        const withMono = resolveAssets(
            { ...BASE_CONFIG, android: { adaptiveIcon: { foreground: 'fg.png', monochrome: 'mono.png' } } },
            testDir,
        );
        expect(withMono.android.adaptiveIcon?.monochrome).toBe(join(testDir, 'mono.png'));
    });

    it('resolves notification icon and color', () => {
        const assets = resolveAssets(
            { ...BASE_CONFIG, android: { notificationIcon: 'notif.png', notificationColor: '#0D9488' } },
            testDir,
        );
        expect(assets.android.notificationIcon).toBe(join(testDir, 'notif.png'));
        expect(assets.android.notificationColor).toBe('#0D9488');
    });

    it('platform splash override beats base for resizeMode and dark', () => {
        const assets = resolveAssets(
            {
                ...BASE_CONFIG,
                splash: { image: 'light.png', backgroundColor: '#FFFFFF', resizeMode: 'center', dark: { backgroundColor: '#111111' } },
                android: { splash: { resizeMode: 'cover', dark: { backgroundColor: '#222222' } } },
            },
            testDir,
        );
        expect(assets.android.splashResizeMode).toBe('cover');
        expect(assets.android.splashDark?.backgroundColor).toBe('#222222');
        expect(assets.ios.splashResizeMode).toBe('center');
        expect(assets.ios.splashDark?.backgroundColor).toBe('#111111');
    });

    it('dark splash falls back to the light image when dark.image is unset', () => {
        const assets = resolveAssets(
            { ...BASE_CONFIG, splash: { image: 'light.png', dark: { backgroundColor: '#000000' } } },
            testDir,
        );
        expect(assets.ios.splashDark?.image).toBe(join(testDir, 'light.png'));
        expect(assets.ios.splashDark?.backgroundColor).toBe('#000000');
    });
});

// ────────────────────────────────────────────────────────────────
// Android adaptive icon (monochrome layer)
// ────────────────────────────────────────────────────────────────

describe('generateAndroidAdaptiveIcon (monochrome)', () => {
    const resDir = () => join(testDir, 'android', 'app', 'src', 'main', 'res');

    it('emits monochrome PNGs and the <monochrome> layer when configured', async () => {
        await writePng('fg.png');
        await writePng('mono.png', { r: 255, g: 255, b: 255, alpha: 1 });
        const assets = resolveAssets(
            { ...BASE_CONFIG, android: { adaptiveIcon: { foreground: 'fg.png', monochrome: 'mono.png' } } },
            testDir,
        );
        await generateAndroidAdaptiveIcon(testDir, resolveConfig(BASE_CONFIG), assets.android);

        for (const density of ['mipmap-mdpi', 'mipmap-hdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi']) {
            expect(existsSync(join(resDir(), density, 'ic_launcher_monochrome.png'))).toBe(true);
        }
        const xml = readFileSync(join(resDir(), 'mipmap-anydpi-v26', 'ic_launcher.xml'), 'utf-8');
        expect(xml).toContain('<monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>');
    });

    it('omits the layer and cleans up stale monochrome assets when unconfigured', async () => {
        await writePng('fg.png');
        await writePng('mono.png');
        const withMono = resolveAssets(
            { ...BASE_CONFIG, android: { adaptiveIcon: { foreground: 'fg.png', monochrome: 'mono.png' } } },
            testDir,
        );
        await generateAndroidAdaptiveIcon(testDir, resolveConfig(BASE_CONFIG), withMono.android);

        const withoutMono = resolveAssets(
            { ...BASE_CONFIG, android: { adaptiveIcon: { foreground: 'fg.png' } } },
            testDir,
        );
        await generateAndroidAdaptiveIcon(testDir, resolveConfig(BASE_CONFIG), withoutMono.android);

        expect(existsSync(join(resDir(), 'mipmap-xxxhdpi', 'ic_launcher_monochrome.png'))).toBe(false);
        const xml = readFileSync(join(resDir(), 'mipmap-anydpi-v26', 'ic_launcher.xml'), 'utf-8');
        expect(xml).not.toContain('<monochrome');
    });

    it('removing adaptiveIcon entirely also removes monochrome artifacts', async () => {
        await writePng('fg.png');
        await writePng('mono.png');
        const withMono = resolveAssets(
            { ...BASE_CONFIG, android: { adaptiveIcon: { foreground: 'fg.png', monochrome: 'mono.png' } } },
            testDir,
        );
        await generateAndroidAdaptiveIcon(testDir, resolveConfig(BASE_CONFIG), withMono.android);

        const none = resolveAssets(BASE_CONFIG, testDir);
        await generateAndroidAdaptiveIcon(testDir, resolveConfig(BASE_CONFIG), none.android);

        expect(existsSync(join(resDir(), 'mipmap-anydpi-v26', 'ic_launcher.xml'))).toBe(false);
        expect(existsSync(join(resDir(), 'mipmap-xxxhdpi', 'ic_launcher_monochrome.png'))).toBe(false);
    });
});

// ────────────────────────────────────────────────────────────────
// iOS icon variants
// ────────────────────────────────────────────────────────────────

describe('generateIosIcon (dark/tinted variants)', () => {
    const appIconDir = () => join(testDir, 'ios', 'TestApp', 'Assets.xcassets', 'AppIcon.appiconset');

    it('emits variant PNGs with luminosity appearances in Contents.json', async () => {
        await writePng('l.png');
        await writePng('d.png', { r: 0, g: 0, b: 0, alpha: 1 });
        await writePng('t.png', { r: 128, g: 128, b: 128, alpha: 1 });
        const config = resolveConfig({ ...BASE_CONFIG });
        const assets = resolveAssets(
            { ...BASE_CONFIG, ios: { icon: { light: 'l.png', dark: 'd.png', tinted: 't.png' } } },
            testDir,
        );
        await generateIosIcon(testDir, config, assets.ios);

        expect(existsSync(join(appIconDir(), 'AppIcon-1024.png'))).toBe(true);
        expect(existsSync(join(appIconDir(), 'AppIcon-1024-dark.png'))).toBe(true);
        expect(existsSync(join(appIconDir(), 'AppIcon-1024-tinted.png'))).toBe(true);

        const contents = JSON.parse(readFileSync(join(appIconDir(), 'Contents.json'), 'utf-8'));
        expect(contents.images).toHaveLength(3);
        const dark = contents.images.find((i: { filename: string }) => i.filename === 'AppIcon-1024-dark.png');
        expect(dark.appearances).toEqual([{ appearance: 'luminosity', value: 'dark' }]);
        const tinted = contents.images.find((i: { filename: string }) => i.filename === 'AppIcon-1024-tinted.png');
        expect(tinted.appearances).toEqual([{ appearance: 'luminosity', value: 'tinted' }]);
    });

    it('flattens the marketing icon to an opaque PNG even when the source has alpha (App Store rejects alpha)', async () => {
        // Source with fully transparent pixels (e.g. rounded corners).
        await writePng('transparent.png', { r: 13, g: 148, b: 136, alpha: 0 });
        const config = resolveConfig({ ...BASE_CONFIG });
        const assets = resolveAssets({ ...BASE_CONFIG, ios: { icon: 'transparent.png' } }, testDir);
        await generateIosIcon(testDir, config, assets.ios);

        const meta = await sharp(join(appIconDir(), 'AppIcon-1024.png')).metadata();
        expect(meta.hasAlpha).toBe(false);
        expect(meta.channels).toBe(3);
    });

    it('emits light-only Contents.json and cleans up stale variants when unset', async () => {
        await writePng('l.png');
        await writePng('d.png');
        const config = resolveConfig({ ...BASE_CONFIG });
        const withDark = resolveAssets(
            { ...BASE_CONFIG, ios: { icon: { light: 'l.png', dark: 'd.png' } } },
            testDir,
        );
        await generateIosIcon(testDir, config, withDark.ios);

        const lightOnly = resolveAssets({ ...BASE_CONFIG, ios: { icon: 'l.png' } }, testDir);
        await generateIosIcon(testDir, config, lightOnly.ios);

        expect(existsSync(join(appIconDir(), 'AppIcon-1024-dark.png'))).toBe(false);
        const contents = JSON.parse(readFileSync(join(appIconDir(), 'Contents.json'), 'utf-8'));
        expect(contents.images).toHaveLength(1);
        expect(contents.images[0].appearances).toBeUndefined();
    });
});

// ────────────────────────────────────────────────────────────────
// Android notification icon + color
// ────────────────────────────────────────────────────────────────

describe('generateAndroidNotificationIcon', () => {
    const resDir = () => join(testDir, 'android', 'app', 'src', 'main', 'res');

    it('emits 24dp-baseline drawables and the color resource', async () => {
        await writePng('notif.png', { r: 255, g: 255, b: 255, alpha: 1 });
        const assets = resolveAssets(
            { ...BASE_CONFIG, android: { notificationIcon: 'notif.png', notificationColor: '#0D9488' } },
            testDir,
        );
        await generateAndroidNotificationIcon(testDir, resolveConfig(BASE_CONFIG), assets.android);

        for (const density of ['drawable-mdpi', 'drawable-hdpi', 'drawable-xhdpi', 'drawable-xxhdpi', 'drawable-xxxhdpi']) {
            expect(existsSync(join(resDir(), density, 'ic_notification.png'))).toBe(true);
        }
        const colors = readFileSync(join(resDir(), 'values', 'notification_colors.xml'), 'utf-8');
        expect(colors).toContain('<color name="notification_color">#0D9488</color>');
    });

    it('cleans up when unconfigured', async () => {
        await writePng('notif.png');
        const configured = resolveAssets(
            { ...BASE_CONFIG, android: { notificationIcon: 'notif.png', notificationColor: '#0D9488' } },
            testDir,
        );
        await generateAndroidNotificationIcon(testDir, resolveConfig(BASE_CONFIG), configured.android);

        const unconfigured = resolveAssets(BASE_CONFIG, testDir);
        await generateAndroidNotificationIcon(testDir, resolveConfig(BASE_CONFIG), unconfigured.android);

        expect(existsSync(join(resDir(), 'drawable-xxxhdpi', 'ic_notification.png'))).toBe(false);
        expect(existsSync(join(resDir(), 'values', 'notification_colors.xml'))).toBe(false);
    });

    it('injects default-notification meta-data into the manifest', async () => {
        const config = resolveConfig({
            ...BASE_CONFIG,
            android: { ...BASE_CONFIG.android, notificationIcon: 'notif.png', notificationColor: '#0D9488' },
        });
        scaffoldAndroid(testDir, config);
        const assets = resolveAssets(
            { ...BASE_CONFIG, android: { notificationIcon: 'notif.png', notificationColor: '#0D9488' } },
            testDir,
        );
        applyAndroidManifestMeta(testDir, resolveConfig(BASE_CONFIG), assets.android);

        const manifest = readFileSync(
            join(testDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
            'utf-8',
        );
        expect(manifest).toContain(
            '<meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_notification" />',
        );
        expect(manifest).toContain(
            '<meta-data android:name="com.google.firebase.messaging.default_notification_color" android:resource="@color/notification_color" />',
        );
        expect(manifest).not.toContain('{{APP_META_DATA}}');
    });

    it('replaces the marker with a no-op comment when unconfigured', async () => {
        const config = resolveConfig(BASE_CONFIG);
        scaffoldAndroid(testDir, config);
        const assets = resolveAssets(BASE_CONFIG, testDir);
        applyAndroidManifestMeta(testDir, resolveConfig(BASE_CONFIG), assets.android);

        const manifest = readFileSync(
            join(testDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
            'utf-8',
        );
        expect(manifest).not.toContain('{{APP_META_DATA}}');
        expect(manifest).not.toContain('default_notification_icon');
    });
});

// ────────────────────────────────────────────────────────────────
// Splash: resizeMode + dark mode
// ────────────────────────────────────────────────────────────────

describe('generateAndroidSplash', () => {
    const resDir = () => join(testDir, 'android', 'app', 'src', 'main', 'res');

    it('uses gravity center by default and fill for cover', async () => {
        await writePng('splash.png');
        const center = resolveAssets({ ...BASE_CONFIG, splash: { image: 'splash.png' } }, testDir);
        await generateAndroidSplash(testDir, resolveConfig(BASE_CONFIG), center.android);
        expect(readFileSync(join(resDir(), 'drawable', 'splash.xml'), 'utf-8')).toContain('android:gravity="center"');

        const cover = resolveAssets(
            { ...BASE_CONFIG, splash: { image: 'splash.png', resizeMode: 'cover' } },
            testDir,
        );
        await generateAndroidSplash(testDir, resolveConfig(BASE_CONFIG), cover.android);
        expect(readFileSync(join(resDir(), 'drawable', 'splash.xml'), 'utf-8')).toContain('android:gravity="fill"');
    });

    it('emits -night resources for a dark splash and cleans them up when removed', async () => {
        await writePng('splash.png');
        await writePng('splash-dark.png', { r: 0, g: 0, b: 0, alpha: 1 });
        const dark = resolveAssets(
            { ...BASE_CONFIG, splash: { image: 'splash.png', dark: { image: 'splash-dark.png', backgroundColor: '#111111' } } },
            testDir,
        );
        await generateAndroidSplash(testDir, resolveConfig(BASE_CONFIG), dark.android);

        expect(existsSync(join(resDir(), 'drawable-night', 'splash.xml'))).toBe(true);
        expect(existsSync(join(resDir(), 'drawable-night', 'splash_logo.png'))).toBe(true);
        const nightColors = readFileSync(join(resDir(), 'values-night', 'splash_colors.xml'), 'utf-8');
        expect(nightColors).toContain('<color name="splash_background">#111111</color>');

        const light = resolveAssets({ ...BASE_CONFIG, splash: { image: 'splash.png' } }, testDir);
        await generateAndroidSplash(testDir, resolveConfig(BASE_CONFIG), light.android);
        expect(existsSync(join(resDir(), 'drawable-night', 'splash.xml'))).toBe(false);
        expect(existsSync(join(resDir(), 'values-night', 'splash_colors.xml'))).toBe(false);
    });
});

describe('generateIosSplash', () => {
    const xcassets = () => join(testDir, 'ios', 'TestApp', 'Assets.xcassets');

    it('emits dark appearances in the imageset and colorset when configured', async () => {
        await writePng('splash.png');
        await writePng('splash-dark.png', { r: 0, g: 0, b: 0, alpha: 1 });
        const config = resolveConfig(BASE_CONFIG);
        const assets = resolveAssets(
            { ...BASE_CONFIG, splash: { image: 'splash.png', backgroundColor: '#FFFFFF', dark: { image: 'splash-dark.png', backgroundColor: '#111111' } } },
            testDir,
        );
        await generateIosSplash(testDir, config, assets.ios);

        const images = JSON.parse(readFileSync(join(xcassets(), 'SplashImage.imageset', 'Contents.json'), 'utf-8'));
        expect(images.images).toHaveLength(6);
        const darkEntries = images.images.filter((i: { appearances?: unknown[] }) => i.appearances);
        expect(darkEntries).toHaveLength(3);
        expect(existsSync(join(xcassets(), 'SplashImage.imageset', 'splash-dark@3x.png'))).toBe(true);

        const colors = JSON.parse(readFileSync(join(xcassets(), 'SplashBackground.colorset', 'Contents.json'), 'utf-8'));
        expect(colors.colors).toHaveLength(2);
        expect(colors.colors[1].appearances).toEqual([{ appearance: 'luminosity', value: 'dark' }]);
    });

    it('emits light-only assets and cleans up dark files when unconfigured', async () => {
        await writePng('splash.png');
        await writePng('splash-dark.png');
        const config = resolveConfig(BASE_CONFIG);
        const dark = resolveAssets(
            { ...BASE_CONFIG, splash: { image: 'splash.png', dark: { image: 'splash-dark.png' } } },
            testDir,
        );
        await generateIosSplash(testDir, config, dark.ios);

        const light = resolveAssets({ ...BASE_CONFIG, splash: { image: 'splash.png' } }, testDir);
        await generateIosSplash(testDir, config, light.ios);

        expect(existsSync(join(xcassets(), 'SplashImage.imageset', 'splash-dark.png'))).toBe(false);
        const images = JSON.parse(readFileSync(join(xcassets(), 'SplashImage.imageset', 'Contents.json'), 'utf-8'));
        expect(images.images).toHaveLength(3);
        const colors = JSON.parse(readFileSync(join(xcassets(), 'SplashBackground.colorset', 'Contents.json'), 'utf-8'));
        expect(colors.colors).toHaveLength(1);
    });
});

// ────────────────────────────────────────────────────────────────
// Idempotency
// ────────────────────────────────────────────────────────────────

describe('idempotency', () => {
    it('re-running generators does not rewrite unchanged outputs', async () => {
        await writePng('fg.png');
        await writePng('mono.png');
        await writePng('splash.png');
        const config = resolveConfig(BASE_CONFIG);
        const assets = resolveAssets(
            {
                ...BASE_CONFIG,
                splash: { image: 'splash.png', dark: { backgroundColor: '#111111' } },
                android: {
                    adaptiveIcon: { foreground: 'fg.png', monochrome: 'mono.png' },
                    notificationIcon: 'mono.png',
                    notificationColor: '#0D9488',
                },
            },
            testDir,
        );
        await generateAndroidAdaptiveIcon(testDir, resolveConfig(BASE_CONFIG), assets.android);
        await generateAndroidNotificationIcon(testDir, resolveConfig(BASE_CONFIG), assets.android);
        await generateAndroidSplash(testDir, resolveConfig(BASE_CONFIG), assets.android);
        await generateIosIcon(testDir, config, assets.ios);
        await generateIosSplash(testDir, config, assets.ios);

        const tracked = [
            join(testDir, 'android', 'app', 'src', 'main', 'res', 'mipmap-anydpi-v26', 'ic_launcher.xml'),
            join(testDir, 'android', 'app', 'src', 'main', 'res', 'drawable-xxxhdpi', 'ic_notification.png'),
            join(testDir, 'android', 'app', 'src', 'main', 'res', 'values-night', 'splash_colors.xml'),
            join(testDir, 'ios', 'TestApp', 'Assets.xcassets', 'AppIcon.appiconset', 'Contents.json'),
            join(testDir, 'ios', 'TestApp', 'Assets.xcassets', 'SplashImage.imageset', 'Contents.json'),
        ];
        const before = tracked.map((p) => statSync(p).mtimeMs);

        await generateAndroidAdaptiveIcon(testDir, resolveConfig(BASE_CONFIG), assets.android);
        await generateAndroidNotificationIcon(testDir, resolveConfig(BASE_CONFIG), assets.android);
        await generateAndroidSplash(testDir, resolveConfig(BASE_CONFIG), assets.android);
        await generateIosIcon(testDir, config, assets.ios);
        await generateIosSplash(testDir, config, assets.ios);

        const after = tracked.map((p) => statSync(p).mtimeMs);
        expect(after).toEqual(before);
    });
});
