/**
 * @sigx/lynx-core — Core native bridge for sigx-lynx
 *
 * Provides the low-level bridge to NativeModules injected by the Lynx runtime.
 * Module packages (@sigx/lynx-haptics, @sigx/lynx-camera, etc.) depend on this.
 *
 * @packageDocumentation
 */

export { getModule, callSync, callAsync, isModuleAvailable, guardModule } from './bridge.js';
export type { PermissionStatus, PermissionResponse } from './permissions.js';
