/**
 * @sigx/lynx-core — Core native bridge for sigx-lynx
 *
 * Provides the low-level bridge to NativeModules injected by the Lynx runtime.
 * Module packages (@sigx/lynx-haptics, @sigx/lynx-camera, etc.) depend on this.
 *
 * @packageDocumentation
 */

export { getModule, callSync, callAsync, isModuleAvailable, guardModule } from './bridge.js';
export { webHostCall, isWebHostAvailable } from './web-host.js';
export { base64ToArrayBuffer, arrayBufferToBase64 } from './base64.js';
export type { PermissionStatus, PermissionResponse } from './permissions.js';

// Platform checks + select(), sourced from the Lynx SystemInfo global.
export { Platform, OS, select } from './platform.js';
export type { PlatformOS, PlatformSelectSpec } from './platform.js';

// Device information (async, native-backed). Complements the synchronous
// Platform surface; served by core's own native module.
export { DeviceInfo } from './device-info.js';
export type { DeviceInfoResult, IosDeviceInfo, AndroidDeviceInfo } from './device-info.js';

// Active build variant (#530) — baked from `signalx.config.ts` `variants` by
// `--variant`. Lets an app render a "DEV"/"STAGING" badge or branch by env.
export { variant, isVariant, isBaseBuild } from './variant.js';

// App foreground/background state (#607) — an ambient lifecycle signal backed
// by the activity/app-lifecycle plumbing core already owns. `AppState` is the
// ambient service (like Platform/DeviceInfo); `useAppState()` is the reactive
// hook.
export { AppState, useAppState, APP_STATE_EVENT } from './app-state.js';
export type { AppStateStatus, AppStateListener } from './app-state.js';

export {
    useFontScale,
    useFontScaleMT,
    readGlobalFontScale,
    FONT_SCALE_EVENT,
    FONT_SCALE_GLOBAL_KEY,
} from './font-scale.js';
export type { RawFontScaleProps } from './font-scale.js';

// Logging — leveled + namespaced logger usable by any package (see logger.ts).
export {
    createLogger,
    setLogLevel,
    getLogLevel,
    enableNamespace,
    disableNamespace,
    addTransport,
    clearTransports,
} from './logger.js';
export type { Logger, LogLevelName, LogRecord, LogTransport } from './logger.js';
export { consoleTransport } from './transports/console.js';

// Install the default transport once at import time. The package entry is this
// barrel, so importing anything from `@sigx/lynx-core` wires console logging.
// Guard with a globalThis flag so module re-evaluation (HMR / multiple bundle
// copies) can't register the console transport twice and duplicate every line.
import { addTransport as __addTransport } from './logger.js';
import { consoleTransport as __consoleTransport } from './transports/console.js';
{
    const g = globalThis as Record<string, unknown>;
    const INSTALLED = '__sigxCoreConsoleTransportInstalled';
    if (!g[INSTALLED]) {
        g[INSTALLED] = true;
        __addTransport(__consoleTransport);
    }
}
