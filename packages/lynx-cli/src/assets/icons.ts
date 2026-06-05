/**
 * App icon generation. Single source PNG → all required sizes for both
 * platforms. Uses sharp for resizing.
 *
 * iOS uses the modern "single-size universal" AppIcon (Xcode 14+) — one
 * 1024×1024 PNG, the asset compiler generates per-device sizes at build time.
 * Drastically simpler than the historical 15-variant matrix. Optional dark /
 * tinted appearance variants (iOS 18) are emitted as additional images with
 * `appearances` entries in Contents.json.
 *
 * Android writes the legacy ic_launcher.png at 5 densities (works on every
 * supported API level) plus, optionally, an adaptive icon for Android 8+
 * (with an optional monochrome layer for Android 13+ themed icons) and a
 * notification small icon.
 */

import sharp from 'sharp';
import { mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedConfig, ResolvedAndroidAssets, ResolvedIosAssets } from '../config/index.js';
import { writeFileIfChanged } from '../util/idempotent-write.js';

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

// Notification small-icon sizes (24dp at each density).
const NOTIFICATION_ICON_DENSITIES: Array<{ name: string; px: number }> = [
    { name: 'drawable-mdpi', px: 24 },
    { name: 'drawable-hdpi', px: 36 },
    { name: 'drawable-xhdpi', px: 48 },
    { name: 'drawable-xxhdpi', px: 72 },
    { name: 'drawable-xxxhdpi', px: 96 },
];

function log(msg: string) {
    console.log(`[sigx] ${msg}`);
}

/** Remove previously-generated files; returns how many were removed. */
function removeArtifacts(baseDir: string, rels: string[]): number {
    let removed = 0;
    for (const rel of rels) {
        const p = join(baseDir, rel);
        if (existsSync(p)) {
            unlinkSync(p);
            removed++;
        }
    }
    return removed;
}

const IOS_ICON_DARK_FILE = 'AppIcon-1024-dark.png';
const IOS_ICON_TINTED_FILE = 'AppIcon-1024-tinted.png';

/**
 * Generate the iOS app icon. Writes a 1024×1024 PNG (plus optional dark /
 * tinted appearance variants) and a Contents.json declaring them as a
 * universal single-size icon.
 */
export async function generateIosIcon(cwd: string, config: ResolvedConfig, ios: ResolvedIosAssets): Promise<void> {
    const appIconDir = join(cwd, 'ios', config.name, 'Assets.xcassets', 'AppIcon.appiconset');
    mkdirSync(appIconDir, { recursive: true });

    const filename = 'AppIcon-1024.png';
    const iconBuf = await sharp(ios.iconSource)
        .resize(1024, 1024, { fit: 'cover' })
        .png()
        .toBuffer();
    writeFileIfChanged(join(appIconDir, filename), iconBuf);

    type IconImage = {
        filename: string;
        idiom: string;
        platform: string;
        size: string;
        appearances?: Array<{ appearance: string; value: string }>;
    };
    const images: IconImage[] = [
        { filename, idiom: 'universal', platform: 'ios', size: '1024x1024' },
    ];

    const variants: Array<{ source: string | null; file: string; value: string }> = [
        { source: ios.iconDark, file: IOS_ICON_DARK_FILE, value: 'dark' },
        { source: ios.iconTinted, file: IOS_ICON_TINTED_FILE, value: 'tinted' },
    ];
    for (const v of variants) {
        if (!v.source) {
            removeArtifacts(appIconDir, [v.file]);
            continue;
        }
        const buf = await sharp(v.source)
            .resize(1024, 1024, { fit: 'cover' })
            .png()
            .toBuffer();
        writeFileIfChanged(join(appIconDir, v.file), buf);
        images.push({
            filename: v.file,
            idiom: 'universal',
            platform: 'ios',
            size: '1024x1024',
            appearances: [{ appearance: 'luminosity', value: v.value }],
        });
    }

    const contents = {
        images,
        info: { author: 'sigx', version: 1 },
    };
    writeFileIfChanged(join(appIconDir, 'Contents.json'), JSON.stringify(contents, null, 2) + '\n');
    const variantNote = images.length > 1
        ? ` + ${images.slice(1).map((i) => i.appearances![0].value).join('/')} variant(s)`
        : '';
    log(`iOS: generated AppIcon (1024 universal${variantNote})`);
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
        writeFileIfChanged(join(dir, 'ic_launcher.png'), buf);
        writeFileIfChanged(join(dir, 'ic_launcher_round.png'), buf);
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

/** Monochrome layer assets, cleaned up independently (the layer is optional). */
const MONOCHROME_ICON_ARTIFACTS = ADAPTIVE_FOREGROUND_DENSITIES.map(
    ({ name }) => `${name}/ic_launcher_monochrome.png`,
);

/**
 * Generate the Android adaptive icon (Android 8+):
 *   - foreground PNG at 5 densities (108dp)
 *   - optional monochrome PNG at the same densities (Android 13+ themed icons)
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
        const removed = removeArtifacts(resDir, [...ADAPTIVE_ICON_ARTIFACTS, ...MONOCHROME_ICON_ARTIFACTS]);
        if (removed > 0) log(`Android: removed ${removed} stale adaptive-icon artifact(s)`);
        return;
    }

    // Foreground PNGs at each density.
    for (const { name, px } of ADAPTIVE_FOREGROUND_DENSITIES) {
        const dir = join(resDir, name);
        mkdirSync(dir, { recursive: true });
        const buf = await sharp(adaptive.foreground)
            .resize(px, px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toBuffer();
        writeFileIfChanged(join(dir, 'ic_launcher_foreground.png'), buf);
    }

    // Monochrome layer (Android 13+ themed icons) — opt-in.
    if (adaptive.monochrome) {
        for (const { name, px } of ADAPTIVE_FOREGROUND_DENSITIES) {
            const dir = join(resDir, name);
            mkdirSync(dir, { recursive: true });
            const buf = await sharp(adaptive.monochrome)
                .resize(px, px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .png()
                .toBuffer();
            writeFileIfChanged(join(dir, 'ic_launcher_monochrome.png'), buf);
        }
    } else {
        removeArtifacts(resDir, MONOCHROME_ICON_ARTIFACTS);
    }

    // Background color resource.
    const valuesDir = join(resDir, 'values');
    mkdirSync(valuesDir, { recursive: true });
    const colorXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${adaptive.backgroundColor}</color>
</resources>
`;
    writeFileIfChanged(join(valuesDir, 'ic_launcher_background.xml'), colorXml);

    // adaptive-icon XML referencing the layers.
    const anydpi = join(resDir, 'mipmap-anydpi-v26');
    mkdirSync(anydpi, { recursive: true });
    const monochromeLine = adaptive.monochrome
        ? '\n    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>'
        : '';
    const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>${monochromeLine}
</adaptive-icon>
`;
    writeFileIfChanged(join(anydpi, 'ic_launcher.xml'), adaptiveXml);
    writeFileIfChanged(join(anydpi, 'ic_launcher_round.xml'), adaptiveXml);

    log(
        `Android: generated adaptive icon (5 foreground densities + bg color ${adaptive.backgroundColor}` +
        `${adaptive.monochrome ? ' + monochrome layer' : ''})`,
    );
}

/**
 * Files written by the notification-icon generator; cleaned up when the user
 * removes `notificationIcon` / `notificationColor` from config.
 */
const NOTIFICATION_ICON_ARTIFACTS = NOTIFICATION_ICON_DENSITIES.map(
    ({ name }) => `${name}/ic_notification.png`,
);
const NOTIFICATION_COLOR_ARTIFACT = 'values/notification_colors.xml';

/**
 * Generate the Android notification small icon (`@drawable/ic_notification`,
 * 24dp baseline) and accent color (`@color/notification_color`). Both are
 * opt-in; `@sigx/lynx-notifications` resolves them by resource name at
 * runtime and falls back to the launcher icon / system default when absent.
 */
export async function generateAndroidNotificationIcon(cwd: string, android: ResolvedAndroidAssets): Promise<void> {
    const resDir = join(cwd, 'android', 'app', 'src', 'main', 'res');

    if (android.notificationIcon) {
        for (const { name, px } of NOTIFICATION_ICON_DENSITIES) {
            const dir = join(resDir, name);
            mkdirSync(dir, { recursive: true });
            const buf = await sharp(android.notificationIcon)
                .resize(px, px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .png()
                .toBuffer();
            writeFileIfChanged(join(dir, 'ic_notification.png'), buf);
        }
    } else {
        removeArtifacts(resDir, NOTIFICATION_ICON_ARTIFACTS);
    }

    if (android.notificationColor) {
        const valuesDir = join(resDir, 'values');
        mkdirSync(valuesDir, { recursive: true });
        const colorXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="notification_color">${android.notificationColor}</color>
</resources>
`;
        writeFileIfChanged(join(resDir, NOTIFICATION_COLOR_ARTIFACT), colorXml);
    } else {
        removeArtifacts(resDir, [NOTIFICATION_COLOR_ARTIFACT]);
    }

    if (android.notificationIcon || android.notificationColor) {
        log(
            `Android: generated notification assets (${android.notificationIcon ? 'icon' : ''}` +
            `${android.notificationIcon && android.notificationColor ? ' + ' : ''}` +
            `${android.notificationColor ? `color ${android.notificationColor}` : ''})`,
        );
    }
}
