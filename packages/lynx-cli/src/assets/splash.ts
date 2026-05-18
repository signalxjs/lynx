/**
 * Splash / launch screen generation.
 *
 * iOS: Uses the `UILaunchScreen` Info.plist dictionary (iOS 14+) — no storyboard
 * needed. We write a centered image (`SplashImage.imageset`) and a background
 * color (`SplashBackground.colorset`); manifest.ts wires them into Info.plist.
 *
 * Android: Layer-list drawable (color + centered bitmap) used as the activity's
 * windowBackground via a Theme.SigxApp.Splash style. MainActivity swaps to the
 * regular theme in onCreate so the splash disappears once the JS is ready.
 * Works on every supported API level (≥ 24).
 */

import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedConfig, ResolvedAndroidAssets, ResolvedPlatformAssets } from '../config/index';

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

// iOS splash image base width — 200pt; @2x = 400, @3x = 600.
const IOS_SPLASH_BASE = 200;

/**
 * Generate iOS splash assets: SplashImage.imageset (1x/2x/3x) + SplashBackground.colorset.
 * Info.plist `UILaunchScreen` dict is wired up by applyIosPlistMeta.
 */
export async function generateIosSplash(cwd: string, config: ResolvedConfig, ios: ResolvedPlatformAssets): Promise<void> {
    const xcassets = join(cwd, 'ios', config.name, 'Assets.xcassets');

    // SplashImage.imageset
    const imageset = join(xcassets, 'SplashImage.imageset');
    mkdirSync(imageset, { recursive: true });
    const sizes = [
        { scale: '1x', px: IOS_SPLASH_BASE, file: 'splash.png' },
        { scale: '2x', px: IOS_SPLASH_BASE * 2, file: 'splash@2x.png' },
        { scale: '3x', px: IOS_SPLASH_BASE * 3, file: 'splash@3x.png' },
    ];
    for (const s of sizes) {
        await sharp(ios.splashImage)
            .resize(s.px, s.px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toFile(join(imageset, s.file));
    }
    const imageContents = {
        images: sizes.map((s) => ({
            filename: s.file,
            idiom: 'universal',
            scale: s.scale,
        })),
        info: { author: 'sigx', version: 1 },
    };
    writeFileSync(join(imageset, 'Contents.json'), JSON.stringify(imageContents, null, 2) + '\n');

    // SplashBackground.colorset
    const colorset = join(xcassets, 'SplashBackground.colorset');
    mkdirSync(colorset, { recursive: true });
    const { r, g, b } = hexToSrgb(ios.splashBackground);
    const colorContents = {
        colors: [
            {
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
            },
        ],
        info: { author: 'sigx', version: 1 },
    };
    writeFileSync(join(colorset, 'Contents.json'), JSON.stringify(colorContents, null, 2) + '\n');

    log(`iOS: generated splash (image + bg ${ios.splashBackground})`);
}

/**
 * Generate Android splash drawable + colors.xml entry. Theme wiring is done at
 * template time (themes.xml ships Theme.SigxApp.Splash; manifest activity uses it).
 */
export async function generateAndroidSplash(cwd: string, android: ResolvedAndroidAssets): Promise<void> {
    const resDir = join(cwd, 'android', 'app', 'src', 'main', 'res');

    // Single-density drawable PNG (256px works visually across screen sizes via gravity=center).
    const drawableDir = join(resDir, 'drawable');
    mkdirSync(drawableDir, { recursive: true });
    await sharp(android.splashImage)
        .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(join(drawableDir, 'splash_logo.png'));

    // Layer-list referencing the splash_background color + centered bitmap.
    const splashXml = `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item><color android:color="@color/splash_background"/></item>
    <item android:gravity="center"><bitmap android:src="@drawable/splash_logo"/></item>
</layer-list>
`;
    writeFileSync(join(drawableDir, 'splash.xml'), splashXml);

    // Splash background color — write a dedicated file so it's idempotent and
    // does not clash with other color resources.
    const valuesDir = join(resDir, 'values');
    mkdirSync(valuesDir, { recursive: true });
    const colorsPath = join(valuesDir, 'splash_colors.xml');
    const colorsXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="splash_background">${android.splashBackground}</color>
</resources>
`;
    writeFileSync(colorsPath, colorsXml);

    log(`Android: generated splash (drawable + bg ${android.splashBackground})`);
}
