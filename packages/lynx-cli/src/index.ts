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
 * - sigx CLI plugin (auto-discovered via package.json `sigx-cli` field)
 *
 * @packageDocumentation
 */

export * from './config/index';
export * from './manifest';
export * from './autolink/index';
export { runPrebuild, loadConfig, loadManifests } from './prebuild';
export { startDevServer } from './dev-server';
export { runDoctor } from './doctor';
export { generateQR } from './qr';
export { getLanIP, getAllLanIPs } from './network';
export { getDeviceStatus, listAndroidDevices, isAdbAvailable, isLynxGoInstalled, launchLynxGo } from './device-detect';
