/**
 * @sigx/lynx-core — Core native bridge for sigx-lynx
 *
 * Provides the low-level bridge to NativeModules injected by the Lynx runtime.
 * Module packages (@sigx/lynx-haptics, @sigx/lynx-camera, etc.) depend on this.
 *
 * @packageDocumentation
 */

export { getModule, callSync, callAsync, isModuleAvailable, guardModule } from './bridge.js';
export { base64ToArrayBuffer, arrayBufferToBase64 } from './base64.js';
export type { PermissionStatus, PermissionResponse } from './permissions.js';

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
import { addTransport as __addTransport } from './logger.js';
import { consoleTransport as __consoleTransport } from './transports/console.js';
__addTransport(__consoleTransport);
