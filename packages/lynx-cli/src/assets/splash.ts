/**
 * Splash / launch screen generation.
 *
 * iOS: Uses the `UILaunchScreen` Info.plist dictionary (iOS 14+) — no storyboard
 * needed. We write a centered image (`SplashImage.imageset`) and a background
 * color (`SplashBackground.colorset`); manifest.ts wires them into Info.plist.
 * Optional dark-mode variants ship as dark-appearance entries in the same
 * imageset/colorset, so the system picks them automatically.
 *
 * Android: Layer-list drawable (color + centered bitmap) used as the activity's
 * windowBackground via a Theme.SigxApp.Splash style. MainActivity swaps to the
 * regular theme in onCreate so the splash disappears once the JS is ready.
 * Works on every supported API level (≥ 24). Dark-mode variants live in
 * `drawable-night` / `values-night`, which resource resolution picks up
 * without any theme changes.
 */

import sharp from 'sharp';
import { mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedConfig, ResolvedAndroidAssets, ResolvedIosAssets, SplashResizeMode } from '../config/index.js';
import { writeFileIfChanged } from '../util/idempotent-write.js';

function log(msg: string) {
    console.log(`[sigx] ${msg}`);
}

/**
 * Convert "#RRGGBB" or "#RGB" to {r, g, b} in 0..1 sRGB components.
 * iOS .colorset stores components as floats in 0..1.
 */
function hexToSrgb(hex: string): { r: number; g: number; b: number } {
    let h = hex.replace('#', '').trim();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6) throw new Error(`Invalid hex color: ${hex}`);
    const n = parseInt(h, 16);
    return {
        r: ((n >> 16) & 0xff) / 255,
        g: ((n >> 8) & 0xff) / 255,
        b: (n & 0xff) / 255,
    };
}

// iOS splash image base width — 200pt; @2x = 400, @3x = 600. 'contain' doubles
// the base so the logo gets real screen presence while still aspect-fitting.
const IOS_SPLASH_BASE = 200;
const IOS_SPLASH_BASE_CONTAIN = 400;

// Android splash logo bounds (px in the baseline drawable). 'center' keeps the
// historical 256px logo; 'contain'/'cover' render larger source bitmaps.
const ANDROID_SPLASH_CENTER = 256;
const ANDROID_SPLASH_LARGE = 512;

function iosSplashBase(mode: SplashResizeMode): number {
    return mode === 'center' ? IOS_SPLASH_BASE : IOS_SPLASH_BASE_CONTAIN;
}

/** iOS colorset color entry for a hex background. */
function iosColorEntry(hex: string, dark: boolean): Record<string, unknown> {
    const { r, g, b } = hexToSrgb(hex);
    return {
        ...(dark ? { appearances: [{ appearance: 'luminosity', value: 'dark' }] } : {}),
        color: {
            'color-space': 'srgb',
            components: {
                red: r.toFixed(3),
                green: g.toFixed(3),
                blue: b.toFixed(3),
                alpha: '1.000',
            },
        },
        idiom: 'universal',
    };
}

const IOS_DARK_SPLASH_FILES = ['splash-dark.png', 'splash-dark@2x.png', 'splash-dark@3x.png'];

/**
 * Generate iOS splash assets: SplashImage.imageset (1x/2x/3x, plus dark
 * variants when configured) + SplashBackground.colorset.
 * Info.plist `UILaunchScreen` dict is wired up by applyIosPlistMeta.
 */
export async function generateIosSplash(cwd: string, config: ResolvedConfig, ios: ResolvedIosAssets): Promise<void> {
    const xcassets = join(cwd, 'ios', config.name, 'Assets.xcassets');
    const base = iosSplashBase(ios.splashResizeMode);

    // SplashImage.imageset
    const imageset = join(xcassets, 'SplashImage.imageset');
    mkdirSync(imageset, { recursive: true });
    const sizes = [
        { scale: '1x', px: base, file: 'splash.png', darkFile: 'splash-dark.png' },
        { scale: '2x', px: base * 2, file: 'splash@2x.png', darkFile: 'splash-dark@2x.png' },
        { scale: '3x', px: base * 3, file: 'splash@3x.png', darkFile: 'splash-dark@3x.png' },
    ];
    type SplashImage = {
        filename: string;
        idiom: string;
        scale: string;
        appearances?: Array<{ appearance: string; value: string }>;
    };
    const images: SplashImage[] = [];
    for (const s of sizes) {
        const buf = await sharp(ios.splashImage)
            .resize(s.px, s.px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toBuffer();
        writeFileIfChanged(join(imageset, s.file), buf);
        images.push({ filename: s.file, idiom: 'universal', scale: s.scale });

        if (ios.splashDark) {
            const darkBuf = await sharp(ios.splashDark.image)
                .resize(s.px, s.px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .png()
                .toBuffer();
            writeFileIfChanged(join(imageset, s.darkFile), darkBuf);
            images.push({
                appearances: [{ appearance: 'luminosity', value: 'dark' }],
                filename: s.darkFile,
                idiom: 'universal',
                scale: s.scale,
            });
        }
    }
    if (!ios.splashDark) {
        for (const f of IOS_DARK_SPLASH_FILES) {
            const p = join(imageset, f);
            if (existsSync(p)) unlinkSync(p);
        }
    }
    const imageContents = {
        images,
        info: { author: 'sigx', version: 1 },
    };
    writeFileIfChanged(join(imageset, 'Contents.json'), JSON.stringify(imageContents, null, 2) + '\n');

    // SplashBackground.colorset
    const colorset = join(xcassets, 'SplashBackground.colorset');
    mkdirSync(colorset, { recursive: true });
    const colors = [iosColorEntry(ios.splashBackground, false)];
    if (ios.splashDark) colors.push(iosColorEntry(ios.splashDark.backgroundColor, true));
    const colorContents = {
        colors,
        info: { author: 'sigx', version: 1 },
    };
    writeFileIfChanged(join(colorset, 'Contents.json'), JSON.stringify(colorContents, null, 2) + '\n');

    log(
        `iOS: generated splash (image + bg ${ios.splashBackground}` +
        `${ios.splashDark ? ` + dark bg ${ios.splashDark.backgroundColor}` : ''})`,
    );
}

/** Layer-list XML for the splash drawable, shaped by resizeMode. */
function androidSplashXml(mode: SplashResizeMode): string {
    // 'cover' stretches the bitmap edge-to-edge (layer-list bitmaps can't
    // aspect-crop); 'contain'/'center' center it at its rendered size.
    const gravity = mode === 'cover' ? 'fill' : 'center';
    return `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item><color android:color="@color/splash_background"/></item>
    <item android:gravity="${gravity}"><bitmap android:src="@drawable/splash_logo"/></item>
</layer-list>
`;
}

function androidSplashLogoPx(mode: SplashResizeMode): number {
    return mode === 'center' ? ANDROID_SPLASH_CENTER : ANDROID_SPLASH_LARGE;
}

function splashColorsXml(color: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="splash_background">${color}</color>
</resources>
`;
}

/** Dark-splash resources, cleaned up when `splash.dark` is removed. */
const ANDROID_DARK_SPLASH_ARTIFACTS = [
    'drawable-night/splash.xml',
    'drawable-night/splash_logo.png',
    'values-night/splash_colors.xml',
];

/**
 * Generate Android splash drawable + colors.xml entry (plus `-night` variants
 * when a dark splash is configured). Theme wiring is done at template time
 * (themes.xml ships Theme.SigxApp.Splash; manifest activity uses it).
 */
export async function generateAndroidSplash(cwd: string, android: ResolvedAndroidAssets): Promise<void> {
    const resDir = join(cwd, 'android', 'app', 'src', 'main', 'res');
    const logoPx = androidSplashLogoPx(android.splashResizeMode);

    // Single-density drawable PNG (gravity handles placement across screen sizes).
    const drawableDir = join(resDir, 'drawable');
    mkdirSync(drawableDir, { recursive: true });
    const splashBuf = await sharp(android.splashImage)
        .resize(logoPx, logoPx, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
    writeFileIfChanged(join(drawableDir, 'splash_logo.png'), splashBuf);

    // Layer-list referencing the splash_background color + the logo bitmap.
    writeFileIfChanged(join(drawableDir, 'splash.xml'), androidSplashXml(android.splashResizeMode));

    // Splash background color — write a dedicated file so it's idempotent and
    // does not clash with other color resources.
    const valuesDir = join(resDir, 'values');
    mkdirSync(valuesDir, { recursive: true });
    writeFileIfChanged(join(valuesDir, 'splash_colors.xml'), splashColorsXml(android.splashBackground));

    // Dark-mode variant: `-night` resources shadow the light ones automatically.
    if (android.splashDark) {
        const nightDrawable = join(resDir, 'drawable-night');
        mkdirSync(nightDrawable, { recursive: true });
        const darkBuf = await sharp(android.splashDark.image)
            .resize(logoPx, logoPx, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toBuffer();
        writeFileIfChanged(join(nightDrawable, 'splash_logo.png'), darkBuf);
        writeFileIfChanged(join(nightDrawable, 'splash.xml'), androidSplashXml(android.splashResizeMode));

        const nightValues = join(resDir, 'values-night');
        mkdirSync(nightValues, { recursive: true });
        writeFileIfChanged(join(nightValues, 'splash_colors.xml'), splashColorsXml(android.splashDark.backgroundColor));
    } else {
        let removed = 0;
        for (const rel of ANDROID_DARK_SPLASH_ARTIFACTS) {
            const p = join(resDir, rel);
            if (existsSync(p)) {
                unlinkSync(p);
                removed++;
            }
        }
        if (removed > 0) log(`Android: removed ${removed} stale dark-splash artifact(s)`);
    }

    log(
        `Android: generated splash (drawable + bg ${android.splashBackground}` +
        `${android.splashDark ? ` + dark bg ${android.splashDark.backgroundColor}` : ''})`,
    );
}
