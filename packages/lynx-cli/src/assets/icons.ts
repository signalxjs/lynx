/**
 * App icon generation. Single source PNG → all required sizes for both
 * platforms. Uses sharp for resizing.
 *
 * iOS uses the modern "single-size universal" AppIcon (Xcode 14+) — one
 * 1024×1024 PNG, the asset compiler generates per-device sizes at build time.
 * Drastically simpler than the historical 15-variant matrix.
 *
 * Android writes the legacy ic_launcher.png at 5 densities (works on every
 * supported API level) plus, optionally, an adaptive icon for Android 8+.
 */

import sharp from 'sharp';
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedConfig, ResolvedAndroidAssets, ResolvedPlatformAssets } from '../config/index.js';

// Android density buckets for the legacy launcher icon.
const ANDROID_DENSITIES: Array<{ name: string; px: number }> = [
    { name: 'mipmap-mdpi', px: 48 },
    { name: 'mipmap-hdpi', px: 72 },
    { name: 'mipmap-xhdpi', px: 96 },
    { name: 'mipmap-xxhdpi', px: 144 },
    { name: 'mipmap-xxxhdpi', px: 192 },
];

// Foreground sizes for the adaptive icon (108dp at each density).
const ADAPTIVE_FOREGROUND_DENSITIES: Array<{ name: string; px: number }> = [
    { name: 'mipmap-mdpi', px: 108 },
    { name: 'mipmap-hdpi', px: 162 },
    { name: 'mipmap-xhdpi', px: 216 },
    { name: 'mipmap-xxhdpi', px: 324 },
    { name: 'mipmap-xxxhdpi', px: 432 },
];

function log(msg: string) {
    console.log(`[sigx] ${msg}`);
}

/**
 * Generate the iOS app icon. Writes a single 1024×1024 PNG and a Contents.json
 * declaring it as a universal single-size icon.
 */
export async function generateIosIcon(cwd: string, config: ResolvedConfig, ios: ResolvedPlatformAssets): Promise<void> {
    const appIconDir = join(cwd, 'ios', config.name, 'Assets.xcassets', 'AppIcon.appiconset');
    mkdirSync(appIconDir, { recursive: true });

    const filename = 'AppIcon-1024.png';
    await sharp(ios.iconSource)
        .resize(1024, 1024, { fit: 'cover' })
        .png()
        .toFile(join(appIconDir, filename));

    const contents = {
        images: [
            {
                filename,
                idiom: 'universal',
                platform: 'ios',
                size: '1024x1024',
            },
        ],
        info: { author: 'sigx', version: 1 },
    };
    writeFileSync(join(appIconDir, 'Contents.json'), JSON.stringify(contents, null, 2) + '\n');
    log('iOS: generated AppIcon (1024 universal)');
}

/**
 * Generate the legacy Android launcher icons at 5 densities, both square
 * (ic_launcher.png) and round (ic_launcher_round.png).
 */
export async function generateAndroidIcons(cwd: string, android: ResolvedAndroidAssets): Promise<void> {
    const resDir = join(cwd, 'android', 'app', 'src', 'main', 'res');
    for (const { name, px } of ANDROID_DENSITIES) {
        const dir = join(resDir, name);
        mkdirSync(dir, { recursive: true });
        const buf = await sharp(android.iconSource)
            .resize(px, px, { fit: 'cover' })
            .png()
            .toBuffer();
        writeFileSync(join(dir, 'ic_launcher.png'), buf);
        writeFileSync(join(dir, 'ic_launcher_round.png'), buf);
    }
    log(`Android: generated launcher icons (${ANDROID_DENSITIES.length} densities × 2 variants)`);
}

/**
 * Files written by the adaptive-icon generator. Tracked so we can clean them
 * up when the user removes `adaptiveIcon` from config — otherwise stale XML
 * in mipmap-anydpi-v26 keeps API 26+ devices showing the adaptive icon.
 */
const ADAPTIVE_ICON_ARTIFACTS = [
    'mipmap-anydpi-v26/ic_launcher.xml',
    'mipmap-anydpi-v26/ic_launcher_round.xml',
    'values/ic_launcher_background.xml',
    ...ADAPTIVE_FOREGROUND_DENSITIES.map(({ name }) => `${name}/ic_launcher_foreground.png`),
];

/**
 * Generate the Android adaptive icon (Android 8+):
 *   - foreground PNG at 5 densities (108dp)
 *   - color resource for background
 *   - mipmap-anydpi-v26/ic_launcher.xml + ic_launcher_round.xml
 *
 * If `adaptiveIcon` is not configured, removes any previously-generated
 * artifacts so the app cleanly reverts to the legacy launcher icon.
 */
export async function generateAndroidAdaptiveIcon(cwd: string, android: ResolvedAndroidAssets): Promise<void> {
    const resDir = join(cwd, 'android', 'app', 'src', 'main', 'res');
    const adaptive = android.adaptiveIcon;

    if (!adaptive) {
        let removed = 0;
        for (const rel of ADAPTIVE_ICON_ARTIFACTS) {
            const p = join(resDir, rel);
            if (existsSync(p)) {
                unlinkSync(p);
                removed++;
            }
        }
        if (removed > 0) log(`Android: removed ${removed} stale adaptive-icon artifact(s)`);
        return;
    }

    // Foreground PNGs at each density.
    for (const { name, px } of ADAPTIVE_FOREGROUND_DENSITIES) {
        const dir = join(resDir, name);
        mkdirSync(dir, { recursive: true });
        await sharp(adaptive.foreground)
            .resize(px, px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toFile(join(dir, 'ic_launcher_foreground.png'));
    }

    // Background color resource.
    const valuesDir = join(resDir, 'values');
    mkdirSync(valuesDir, { recursive: true });
    const colorXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${adaptive.backgroundColor}</color>
</resources>
`;
    writeFileSync(join(valuesDir, 'ic_launcher_background.xml'), colorXml);

    // adaptive-icon XML referencing both layers.
    const anydpi = join(resDir, 'mipmap-anydpi-v26');
    mkdirSync(anydpi, { recursive: true });
    const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
    writeFileSync(join(anydpi, 'ic_launcher.xml'), adaptiveXml);
    writeFileSync(join(anydpi, 'ic_launcher_round.xml'), adaptiveXml);

    log(`Android: generated adaptive icon (5 foreground densities + bg color ${adaptive.backgroundColor})`);
}
