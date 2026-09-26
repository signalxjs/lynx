/**
 * Default Android SDK install locations — where Android Studio's setup
 * wizard puts the SDK when the user never exports ANDROID_HOME. Shared by
 * the SDK, adb and emulator lookups (and `sigx doctor`) so they agree.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

export function defaultAndroidSdkRoots(
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env,
    home: string = homedir(),
): string[] {
    if (platform === 'darwin') return [join(home, 'Library', 'Android', 'sdk')];
    if (platform === 'win32') {
        const localAppData = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
        return [join(localAppData, 'Android', 'Sdk')];
    }
    return [join(home, 'Android', 'Sdk')];
}

/** `<sdk>/platform-tools/adb(.exe)` */
export function sdkAdbPath(sdkRoot: string, platform: NodeJS.Platform = process.platform): string {
    return join(sdkRoot, 'platform-tools', platform === 'win32' ? 'adb.exe' : 'adb');
}

/** `<sdk>/emulator/emulator(.exe)` */
export function sdkEmulatorPath(sdkRoot: string, platform: NodeJS.Platform = process.platform): string {
    return join(sdkRoot, 'emulator', platform === 'win32' ? 'emulator.exe' : 'emulator');
}
