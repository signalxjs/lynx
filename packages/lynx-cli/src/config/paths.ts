/**
 * Path helpers — resolve where prebuild reads from / writes to.
 *
 * Layout convention (single, since host-target was retired in Phase 13):
 *   cwd/ios/<name>/                 (Swift sources)
 *   cwd/ios/<name>.xcodeproj/       (Xcode project)
 *   cwd/ios/Podfile                 (CocoaPods)
 *   cwd/android/                    (Gradle module root)
 *   cwd/android/app/                (app module)
 */

import { join } from 'node:path';
import type { ResolvedConfig } from './parser.js';

/** Root dir holding the iOS Xcode project + Swift sources. */
export function iosProjectRoot(cwd: string, _config: ResolvedConfig): string {
    return join(cwd, 'ios');
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

/** Root dir holding the Android Gradle project. */
export function androidProjectRoot(cwd: string, _config: ResolvedConfig): string {
    return join(cwd, 'android');
}

/** The Android `app/` module dir. */
export function androidAppDir(cwd: string, config: ResolvedConfig): string {
    return join(androidProjectRoot(cwd, config), 'app');
}

/** Root of the Kotlin source tree (above the package-derived subdirs). */
export function androidKotlinRoot(cwd: string, config: ResolvedConfig): string {
    return join(androidAppDir(cwd, config), 'src', 'main', 'kotlin');
}

/** AndroidManifest.xml path. */
export function androidManifestPath(cwd: string, config: ResolvedConfig): string {
    return join(androidAppDir(cwd, config), 'src', 'main', 'AndroidManifest.xml');
}

/** app/build.gradle.kts path. */
export function androidBuildGradlePath(cwd: string, config: ResolvedConfig): string {
    return join(androidAppDir(cwd, config), 'build.gradle.kts');
}
