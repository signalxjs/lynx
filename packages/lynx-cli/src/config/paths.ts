/**
 * Path helpers — resolve where prebuild reads from / writes to.
 *
 * Layout convention (single, since host-target was retired in Phase 13):
 *   cwd/ios/<name>/                 (Swift sources)
 *   cwd/ios/<name>.xcodeproj/       (Xcode project)
 *   cwd/ios/Podfile                 (CocoaPods)
 *   cwd/android/                    (Gradle module root)
 *   cwd/android/app/                (app module)
 *
 * Build variants (#530) get their own sibling output dirs so they never
 * overwrite each other's generated native projects:
 *   cwd/android-<variant>/   cwd/ios-<variant>/
 * The base (no variant) keeps the bare `android`/`ios` names — fully
 * backward-compatible. The dir-name primitives below take a plain variant
 * string (not a ResolvedConfig) so callers that run *before* the config is
 * loaded — the prebuild fast-path / fingerprint sentinels — can resolve the
 * output dirs too.
 */

import { join } from 'node:path';
import type { ResolvedConfig } from './parser.js';

/** Name of the Android output dir for a variant (base → `android`). */
export function androidDirName(variant?: string): string {
    return variant ? `android-${variant}` : 'android';
}

/** Name of the iOS output dir for a variant (base → `ios`). */
export function iosDirName(variant?: string): string {
    return variant ? `ios-${variant}` : 'ios';
}

/** Root dir holding the iOS Xcode project + Swift sources. */
export function iosProjectRoot(cwd: string, config: ResolvedConfig): string {
    return join(cwd, iosDirName(config.variant));
}

/** Dir containing the app's Swift sources (peer to .xcodeproj). */
export function iosSourceRoot(cwd: string, config: ResolvedConfig): string {
    return join(iosProjectRoot(cwd, config), config.name);
}

/** Path to the .xcodeproj bundle. */
export function iosXcodeProjPath(cwd: string, config: ResolvedConfig): string {
    return join(iosProjectRoot(cwd, config), `${config.name}.xcodeproj`);
}

/** Path to the Podfile. */
export function iosPodfilePath(cwd: string, config: ResolvedConfig): string {
    return join(iosProjectRoot(cwd, config), 'Podfile');
}

/** Path to Info.plist. */
export function iosInfoPlistPath(cwd: string, config: ResolvedConfig): string {
    return join(iosSourceRoot(cwd, config), 'Info.plist');
}

/** The `<sources>/Assets.xcassets` dir holding the app icon + splash image sets. */
export function iosAssetsDir(cwd: string, config: ResolvedConfig): string {
    return join(iosSourceRoot(cwd, config), 'Assets.xcassets');
}

/** Root dir holding the Android Gradle project. */
export function androidProjectRoot(cwd: string, config: ResolvedConfig): string {
    return join(cwd, androidDirName(config.variant));
}

/** The Android `app/` module dir. */
export function androidAppDir(cwd: string, config: ResolvedConfig): string {
    return join(androidProjectRoot(cwd, config), 'app');
}

/**
 * Root of a Kotlin source tree (above the package-derived subdirs).
 * Defaults to the `main` source set; dev-client sources land in `debug`
 * and their no-op stubs in `release` so release builds compile without
 * the dev client's debug-only dependencies.
 */
export function androidKotlinRoot(
    cwd: string,
    config: ResolvedConfig,
    sourceSet: 'main' | 'debug' | 'release' = 'main',
): string {
    return join(androidAppDir(cwd, config), 'src', sourceSet, 'kotlin');
}

/** `src/debug/AndroidManifest.xml` — debug-variant manifest overlay. */
export function androidDebugManifestPath(cwd: string, config: ResolvedConfig): string {
    return join(androidAppDir(cwd, config), 'src', 'debug', 'AndroidManifest.xml');
}

/** AndroidManifest.xml path. */
export function androidManifestPath(cwd: string, config: ResolvedConfig): string {
    return join(androidAppDir(cwd, config), 'src', 'main', 'AndroidManifest.xml');
}

/** app/build.gradle.kts path. */
export function androidBuildGradlePath(cwd: string, config: ResolvedConfig): string {
    return join(androidAppDir(cwd, config), 'build.gradle.kts');
}

/** `app/src/main/res` — the Android resource dir (icons, splash, values). */
export function androidResDir(cwd: string, config: ResolvedConfig): string {
    return join(androidAppDir(cwd, config), 'src', 'main', 'res');
}
