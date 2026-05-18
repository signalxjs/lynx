/**
 * Info.plist / AndroidManifest.xml / build.gradle.kts mutations for app
 * metadata that doesn't ship as a binary asset:
 *
 *   - orientation lock
 *   - URL scheme (deep linking)
 *   - iOS UILaunchScreen (references SplashImage / SplashBackground from Assets.xcassets)
 *   - iOS CFBundleVersion (build number)
 *   - Android versionCode
 *
 * All of these run *after* the templated files have been written, by replacing
 * `<!-- {{PLACEHOLDER}} -->` markers in the scaffolded native files. Idempotent.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedConfig, ResolvedAndroidAssets, ResolvedPlatformAssets } from '../config/index';

function log(msg: string) {
    console.log(`[sigx] ${msg}`);
}

// ────────────────────────────────────────────────────────────────
// iOS
// ────────────────────────────────────────────────────────────────

function iosOrientationsXml(orientation: ResolvedPlatformAssets['orientation']): string {
    const inner = (() => {
        switch (orientation) {
            case 'portrait':
                return ['UIInterfaceOrientationPortrait'];
            case 'landscape':
                return ['UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'];
            case 'default':
            default:
                return [
                    'UIInterfaceOrientationPortrait',
                    'UIInterfaceOrientationLandscapeLeft',
                    'UIInterfaceOrientationLandscapeRight',
                ];
        }
    })();
    return [
        '    <key>UISupportedInterfaceOrientations</key>',
        '    <array>',
        ...inner.map((o) => `        <string>${o}</string>`),
        '    </array>',
    ].join('\n');
}

function iosLaunchScreenXml(): string {
    // Always emit — the asset catalog always carries SplashImage + SplashBackground
    // (defaults to bundled placeholders when user hasn't configured a splash).
    return [
        '    <key>UILaunchScreen</key>',
        '    <dict>',
        '        <key>UIColorName</key>',
        '        <string>SplashBackground</string>',
        '        <key>UIImageName</key>',
        '        <string>SplashImage</string>',
        '    </dict>',
    ].join('\n');
}

function iosUrlSchemesXml(scheme: string | null): string {
    if (!scheme) return '<!-- (no URL scheme configured) -->';
    return [
        '    <key>CFBundleURLTypes</key>',
        '    <array>',
        '        <dict>',
        '            <key>CFBundleURLSchemes</key>',
        '            <array>',
        `                <string>${scheme}</string>`,
        '            </array>',
        '        </dict>',
        '    </array>',
    ].join('\n');
}

/**
 * Apply orientation, URL schemes, launch screen, and CFBundleVersion to Info.plist.
 */
export function applyIosPlistMeta(cwd: string, config: ResolvedConfig, ios: ResolvedPlatformAssets): void {
    const plistFile = join(cwd, 'ios', config.name, 'Info.plist');
    if (!existsSync(plistFile)) return;

    let content = readFileSync(plistFile, 'utf-8');
    content = content.replace('    <!-- {{ORIENTATIONS}} -->', iosOrientationsXml(ios.orientation));
    content = content.replace('    <!-- {{LAUNCH_SCREEN}} -->', iosLaunchScreenXml());
    content = content.replace('    <!-- {{URL_SCHEMES}} -->', `    ${iosUrlSchemesXml(ios.scheme)}`);
    writeFileSync(plistFile, content);
    log(`iOS: applied Info.plist meta (orientation=${ios.orientation}, scheme=${ios.scheme ?? 'none'})`);
}

// ────────────────────────────────────────────────────────────────
// Android
// ────────────────────────────────────────────────────────────────

function androidOrientationValue(orientation: ResolvedAndroidAssets['orientation']): string {
    switch (orientation) {
        case 'portrait':
            return 'portrait';
        case 'landscape':
            return 'landscape';
        case 'default':
        default:
            return 'unspecified';
    }
}

function androidIntentFilterXml(scheme: string | null): string {
    if (!scheme) return '<!-- (no URL scheme configured) -->';
    return [
        '            <intent-filter>',
        '                <action android:name="android.intent.action.VIEW"/>',
        '                <category android:name="android.intent.category.DEFAULT"/>',
        '                <category android:name="android.intent.category.BROWSABLE"/>',
        `                <data android:scheme="${scheme}"/>`,
        '            </intent-filter>',
    ].join('\n');
}

/**
 * Apply orientation + intent-filter (deep link scheme) to AndroidManifest.xml.
 */
export function applyAndroidManifestMeta(cwd: string, android: ResolvedAndroidAssets): void {
    const manifestFile = join(cwd, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
    if (!existsSync(manifestFile)) return;

    let content = readFileSync(manifestFile, 'utf-8');
    content = content.replace('{{orientation}}', androidOrientationValue(android.orientation));
    content = content.replace('            <!-- {{INTENT_FILTERS}} -->', androidIntentFilterXml(android.scheme));
    writeFileSync(manifestFile, content);
    log(`Android: applied manifest meta (orientation=${android.orientation}, scheme=${android.scheme ?? 'none'})`);
}

/**
 * Apply versionCode to app/build.gradle.kts. Replaces a {{versionCode}}
 * placeholder seeded by the template; safe to re-run after a hand-edit because
 * we also recognise an existing numeric `versionCode = N` line as a no-op match.
 */
export function applyAndroidGradleMeta(cwd: string, config: ResolvedConfig): void {
    const gradleFile = join(cwd, 'android', 'app', 'build.gradle.kts');
    if (!existsSync(gradleFile)) return;

    let content = readFileSync(gradleFile, 'utf-8');
    const target = String(config.android.versionCode);
    if (content.includes('{{versionCode}}')) {
        content = content.split('{{versionCode}}').join(target);
    } else {
        content = content.replace(/versionCode\s*=\s*\d+/g, `versionCode = ${target}`);
    }
    writeFileSync(gradleFile, content);
    log(`Android: applied build.gradle meta (versionCode=${target})`);
}
