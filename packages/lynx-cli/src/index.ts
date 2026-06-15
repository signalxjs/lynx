/**
 * @sigx/lynx-cli — Lynx CLI plugin for sigx
 *
 * Provides:
 * - Config schema (`defineLynxConfig()`) and parser
 * - Module manifest (`signalx-module.json`) schema and validation
 * - Auto-linkers for Android and iOS
 * - Prebuild orchestration (`runPrebuild()`)
 * - Dev server with QR code, LAN IP, device detection
 * - Doctor command for environment validation
 * - OTA publishing (`runUpdatesPublish()`; programmatic core re-exported from
 *   `@sigx/lynx-updates-publisher`)
 * - sigx CLI plugin (auto-discovered via package.json `sigx-cli` field)
 *
 * @packageDocumentation
 */

export * from './config/index.js';
export * from './manifest.js';
export * from './autolink/index.js';
export { runPrebuild, loadConfig, loadManifests } from './prebuild.js';
export { startDevServer } from './dev-server.js';
export { runDoctor } from './doctor.js';
export { generateQR } from '@sigx/terminal';
export { getLanIP, getAllLanIPs } from './network.js';
export { getDeviceStatus, listAndroidDevices, isAdbAvailable, isLynxGoInstalled, launchLynxGo } from './device-detect.js';
export { runUpdatesPublish, type UpdatesPublishOptions } from './updates-publish.js';
// Re-exported for CI: the dependency-light programmatic publish API.
export {
    publishUpdate,
    type PublishUpdateOptions,
    type PublishUpdateResult,
    type PublishPlatform,
} from '@sigx/lynx-updates-publisher';
