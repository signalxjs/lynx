/**
 * @packageDocumentation
 *
 * An rsbuild / rspeedy plugin that integrates SignalX with Lynx's dual-thread
 * architecture (Background Thread renderer + Main Thread PAPI executor).
 *
 * @example
 * ```ts
 * // lynx.config.ts
 * import { defineConfig } from '@lynx-js/rspeedy'
 * import { pluginSigxLynx } from '@sigx/lynx-plugin'
 *
 * export default defineConfig({
 *   plugins: [pluginSigxLynx()],
 * })
 * ```
 */

import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RsbuildPlugin } from '@rsbuild/core';

import { applyCSS } from './css.js';
import { applyEntry } from './entry.js';
import { applyIcons } from './icons.js';
import { LAYERS } from './layers.js';
import { createLogWebSocketServer, LOG_ENDPOINT_PATH, type LogWebSocketServer } from './log-server.js';

export { LAYERS, applyEntry };

const _pluginDirname = path.dirname(fileURLToPath(import.meta.url));
const _sigxLynxRoot = path.resolve(_pluginDirname, '../..');

/** Wildcard addresses that bind to all interfaces but aren't routable from other devices. */
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '0:0:0:0:0:0:0:0']);

/**
 * Interface names that are virtual adapters (Hyper-V, WSL, Docker, VPN, etc.)
 * and should be skipped when looking for the real LAN address.
 */
const VIRTUAL_IF_PATTERNS = /^(vEthernet|veth|docker|br-|virbr|vmnet|VirtualBox|Hyper-V|WSL|ham\d)/i;

/**
 * Detect the real LAN IPv4 address on this machine.
 * Skips virtual/container adapters (Hyper-V, WSL, Docker) and prefers
 * physical interfaces like Wi-Fi or Ethernet.
 * Falls back to the first external IPv4 if no physical match is found,
 * and ultimately to `'127.0.0.1'`.
 */
function detectLanIPv4(): string {
  const ifaces = networkInterfaces();
  let fallback: string | undefined;

  for (const [name, nets] of Object.entries(ifaces)) {
    for (const net of nets ?? []) {
      if (net.family !== 'IPv4' || net.internal || !net.address) continue;
      // Remember first external address as fallback
      if (!fallback) fallback = net.address;
      // Skip virtual adapters
      if (VIRTUAL_IF_PATTERNS.test(name)) continue;
      return net.address;
    }
  }
  return fallback ?? '127.0.0.1';
}

/** Shape of the `logging` config plumbed from `@sigx/lynx-cli` via env. */
interface LoggingConfigLike {
  level?: string;
  namespaces?: { disabled?: string[] };
  production?: unknown;
}

/** Parse the app's `logging` config from `SIGX_LYNX_LOGGING` (set by lynx-cli). */
function readLoggingConfig(): LoggingConfigLike {
  const raw = process.env['SIGX_LYNX_LOGGING'];
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as LoggingConfigLike) : {};
  } catch {
    return {};
  }
}

/** Extract the hostname from a URL string (may be inside JSON quotes). */
function extractHost(s: string): string {
  const m = s.match(/\/\/([^:/]+)/);
  return m ? m[1] : '';
}

/**
 * Read the per-platform OTA runtime-version fingerprints written by
 * `sigx prebuild` (`.sigx/runtime-versions.json`). Informational in the JS
 * bundle (`__SIGX_RUNTIME_VERSIONS__`) — the native binary's baked value is
 * authoritative at update-check time. `null` when no prebuild has run.
 */
function readRuntimeVersions(rootPath: string): { android?: string; ios?: string } | null {
  try {
    const raw = readFileSync(path.join(rootPath, '.sigx', 'runtime-versions.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const { android, ios } = parsed as { android?: string; ios?: string };
      return {
        ...(typeof android === 'string' ? { android } : {}),
        ...(typeof ios === 'string' ? { ios } : {}),
      };
    }
  } catch {
    // No sidecar (prebuild not run / web-only project) — define null.
  }
  return null;
}

/**
 * Options for {@link pluginSigxLynx}.
 * @public
 */
export interface PluginSigxLynxOptions {
  /**
   * Whether to enable CSS selector support in the Lynx template.
   * @defaultValue true
   */
  enableCSSSelector?: boolean;

  /**
   * Whether to enable CSS inheritance in the Lynx engine.
   * @defaultValue false
   */
  enableCSSInheritance?: boolean;

  /**
   * A list of additional CSS properties to inherit beyond the engine defaults.
   * Only effective when {@link enableCSSInheritance} is `true`.
   */
  customCSSInheritanceList?: string[];

  /**
   * Whether to place debug info outside the template bundle.
   * @defaultValue true
   */
  debugInfoOutside?: boolean;
}

/**
 * Create an rsbuild / rspeedy plugin for SignalX-Lynx dual-thread rendering.
 *
 * @public
 */
export function pluginSigxLynx(
  options: PluginSigxLynxOptions = {},
): RsbuildPlugin {
  const {
    enableCSSSelector: _enableCSSSelector = true,
    enableCSSInheritance: _enableCSSInheritance = false,
    customCSSInheritanceList: _customCSSInheritanceList,
    debugInfoOutside: _debugInfoOutside = true,
  } = options;

  return {
    name: 'lynx:sigx',
    // Must run after rspeedy's own config plugins (including pluginDev for URL fixes)
    pre: ['lynx:rsbuild:plugin-api', 'lynx:config', 'lynx:rsbuild:dev'],

    async setup(api) {
      api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) => {
        // Compile all JS files (including node_modules) for ES2019 compat
        // with the Lynx JS engine, unless user explicitly sets source.include.
        const userConfig = api.getRsbuildConfig('original');
        if (typeof userConfig.source?.include === 'undefined') {
          config = mergeRsbuildConfig(config, {
            source: {
              include: [/\.(?:js|mjs|cjs)$/],
            },
          });
        }

        // Honour `SIGX_LYNX_DEV_PORT` set by `@sigx/lynx-cli`. Rspeedy's CLI
        // has no `--port` flag, so the CLI plumbs its computed port (from
        // `sigx dev --port N` or the lynx-cli default) through this env var
        // and we override `server.port` here. Without this, `serverState.port`
        // on the lynx-cli side (used to build the device-launch URL) could
        // diverge from whatever the user's `lynx.config.ts` set — and the
        // device would boot pointing at a server that isn't there.
        const envPort = process.env['SIGX_LYNX_DEV_PORT'];
        const portOverride = envPort && Number.isFinite(Number(envPort))
          ? Number(envPort)
          : undefined;
        if (portOverride !== undefined) {
          config = mergeRsbuildConfig(config, {
            server: { port: portOverride },
          });
        }

        // App logging config, plumbed from `signalx.config.ts` by
        // `@sigx/lynx-cli` (via `SIGX_LYNX_LOGGING` on this process's env, which
        // the rspeedy child inherits). Drives the logger defaults below and the
        // release auto-wire of `@sigx/lynx-observability` in `applyEntry`.
        const logging = readLoggingConfig();
        const isProd = process.env['NODE_ENV'] === 'production';

        return mergeRsbuildConfig(config, {
          source: {
            define: {
              __DEV__: 'process.env.NODE_ENV !== \'production\'',
              // Logger defaults, injected as plain literals (resolved here in
              // Node, where `process` is safe). The logger reads these and must
              // NOT reference `__DEV__` — that define expands to a `process.env`
              // expression that throws in the Lynx BG runtime. Overridable at
              // runtime via `setLogLevel()` / `enableNamespace()`.
              __SIGX_LOG_LEVEL__: JSON.stringify(logging.level ?? (isProd ? 'warn' : 'debug')),
              __SIGX_LOG_DISABLED__: JSON.stringify(logging.namespaces?.disabled ?? []),
              // Production observability config (read by the auto-wired
              // `@sigx/lynx-observability/install` entry). `null` when unset.
              __SIGX_OBSERVABILITY_CONFIG__: JSON.stringify(logging.production ?? null),
              // OTA updates (`@sigx/lynx-updates`): per-platform runtime
              // fingerprints from the last prebuild (informational; native
              // value is authoritative) and the default release channel
              // (plumbed from signalx.config.ts by lynx-cli).
              __SIGX_RUNTIME_VERSIONS__: JSON.stringify(readRuntimeVersions(api.context.rootPath)),
              __SIGX_UPDATES_CHANNEL__: JSON.stringify(process.env['SIGX_LYNX_UPDATES_CHANNEL'] || 'production'),
            },
          },
          tools: {
            rspack: {
              output: {
                iife: false,
              },
            },
            swc: {
              jsc: {
                target: 'es2019',
                transform: {
                  react: {
                    runtime: 'automatic',
                    importSource: '@sigx/lynx',
                    throwIfNamespace: false,
                  },
                },
              },
            },
          },
        });
      });

      // -------------------------------------------------------------------
      // Dev-only: console log streaming. Two pieces:
      //   1. `onAfterStartDevServer` boots a tiny `ws` server on
      //      `devServerPort + 1` that receives batched log entries from
      //      devices and emits them on stdout for the CLI to pretty-print.
      //   2. `source.define` bakes the ws URL into the BG bundle so
      //      `@sigx/lynx-dev-client/install` can pick it up at runtime.
      // Both are gated on NODE_ENV !== 'production'.
      //
      // The Lynx BG runtime on Android has no `fetch` / `XHR` / `lynx.fetch`,
      // so HTTP isn't an option for the device side. WebSocket is shipped by
      // `@sigx/lynx-websocket` (URLSessionWebSocketTask on iOS, OkHttp on
      // Android), which the dev-client imports as a side-effect.
      // -------------------------------------------------------------------
      const isDevServer = process.env['NODE_ENV'] !== 'production';
      if (isDevServer) {
        const lanIP = detectLanIPv4();
        let logServer: LogWebSocketServer | undefined;
        let wsPort = 0;
        // Build identity for this server lifetime. `@sigx/lynx-cli` owns it and
        // plumbs it through `SIGX_LYNX_BUILD_ID` so the launch URL, the baked
        // `__SIGX_BUILD_ID__` define, and the log-server hello all match. When
        // rspeedy is run directly (no CLI), fall back to a per-process id.
        const buildId = process.env['SIGX_LYNX_BUILD_ID'] || `${Date.now()}-${process.pid}`;

        api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) => {
          const envPort = process.env['SIGX_LYNX_DEV_PORT'];
          const httpPort = envPort && Number.isFinite(Number(envPort))
            ? Number(envPort)
            : (config.server?.port ?? 3000);
          wsPort = httpPort + 1;
          const logUrl = `ws://${lanIP}:${wsPort}${LOG_ENDPOINT_PATH}`;

          return mergeRsbuildConfig(config, {
            source: {
              define: {
                __SIGX_DEV_LOG_URL__: JSON.stringify(logUrl),
                // The device streamer compares this to the server's hello id
                // and reloads when they differ — so a reconnect after a
                // restart picks up the latest bundle.
                __SIGX_BUILD_ID__: JSON.stringify(buildId),
              },
            },
          });
        });

        api.onAfterStartDevServer(async () => {
          if (logServer) return;
          try {
            logServer = await createLogWebSocketServer({ port: wsPort, buildId });
            api.logger.info(
              `[sigx-lynx] device log ws → ws://${lanIP}:${logServer.port}${LOG_ENDPOINT_PATH}`,
            );
          } catch (err) {
            api.logger.warn(
              `[sigx-lynx] device log ws failed to start on port ${wsPort}: ${(err as Error).message}`,
            );
          }
        });

        const stopLogServer = async (): Promise<void> => {
          if (!logServer) return;
          const s = logServer;
          logServer = undefined;
          await s.close();
        };
        api.onCloseDevServer(stopLogServer);
        api.onExit(() => { void stopLogServer(); });
      }

      api.modifyBundlerChain((chain) => {
        chain.resolve.alias.set(
          '@sigx/runtime-dom',
          '@sigx/lynx-runtime',
        );
      });

      // rspeedy's pluginDev uses `server.host` as the hostname for HMR
      // client URLs (publicPath, WebSocket URL, printUrls). When the user
      // sets server.host to '0.0.0.0' (bind all interfaces), those URLs
      // become unreachable from external devices (phones, emulators).
      //
      // Fix at the rsbuild config level (runs AFTER rspeedy's hooks thanks
      // to 'lynx:rsbuild:dev' in `pre`): replace wildcard hosts with the
      // actual LAN IP in dev.assetPrefix, dev.client.host, output.assetPrefix,
      // and the server.printUrls function.
      api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) => {
        const devAssetPrefix = config.dev?.assetPrefix;
        if (typeof devAssetPrefix !== 'string') return config;

        // Only fix if the assetPrefix contains a wildcard host
        let needsFix = false;
        for (const wh of WILDCARD_HOSTS) {
          if (devAssetPrefix.includes(`//${wh}:`)) {
            needsFix = true;
            break;
          }
        }
        if (!needsFix) return config;

        const lanIP = detectLanIPv4();
        const replaceWildcard = (s: string): string => {
          for (const wh of WILDCARD_HOSTS) {
            s = s.replaceAll(`//${wh}:`, `//${lanIP}:`);
          }
          return s;
        };

        const fixedAssetPrefix = replaceWildcard(devAssetPrefix);

        // Override printUrls to show the correct LAN IP URL.
        // rspeedy's printUrls uses closure variables that still hold '0.0.0.0',
        // so we must replace the function entirely.
        const existingPrintUrls = config.server?.printUrls;
        const printUrlsFn = typeof existingPrintUrls === 'function'
          ? (param: Parameters<typeof existingPrintUrls>[0]) => {
              // Call rspeedy's original printUrls to get the URL list,
              // then fix the hostnames in each URL.
              const result = existingPrintUrls(param);
              if (Array.isArray(result)) {
                return result.map((item: any) =>
                  typeof item === 'string'
                    ? replaceWildcard(item)
                    : { ...item, url: replaceWildcard(item.url) }
                );
              }
              return result;
            }
          : undefined;

        const merged = mergeRsbuildConfig(config, {
          dev: {
            assetPrefix: fixedAssetPrefix,
            client: {
              host: lanIP,
            },
          },
          output: {
            assetPrefix: fixedAssetPrefix,
          },
        });

        // Direct assignment — mergeRsbuildConfig can't reliably merge functions
        if (printUrlsFn) {
          merged.server = { ...merged.server, printUrls: printUrlsFn };
        }

        return merged;
      });

      // Rspack's default watcher-ignore is only /node_modules|\.git/. In Lynx
      // app layouts the ios/ Pods tree and dist/ output drown macOS FSEvents,
      // causing edits to src/*.tsx to silently not fire rebuilds. Narrow the
      // watched set and stop chasing symlinks through pnpm's .pnpm/ store.
      //
      // Upstream: fixed in Rspack 2.0 (`fix(watcher): filter stale FSEvents
      // with mtime baseline comparison`). Rspeedy 0.14.2 still pins Rspack
      // 1.7.10, so we can't adopt the real fix yet — revisit when rspeedy
      // bumps to Rspack 2.0 and we can drop this hook.
      api.modifyRspackConfig((rspackConfig) => {
        const existing = rspackConfig.watchOptions ?? {};
        const existingIgnored = Array.isArray(existing.ignored)
          ? existing.ignored
          : typeof existing.ignored === 'string'
            ? [existing.ignored]
            : [];

        rspackConfig.watchOptions = {
          ...existing,
          ignored: [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/ios/**',
            '**/android/**',
            '**/Pods/**',
            '**/.rspeedy/**',
            ...existingIgnored,
          ],
          followSymlinks: existing.followSymlinks ?? false,
          poll: existing.poll
            ?? (process.env.SIGX_LYNX_WATCH_POLL
              ? Number(process.env.SIGX_LYNX_WATCH_POLL) || true
              : undefined),
        };
      });

      // Belt-and-suspenders: also patch at the rspack config level in case
      // the rsbuild-level fix didn't propagate everywhere (e.g. resolve
      // aliases set by rspeedy's modifyBundlerChain using closure variables).
      api.modifyRspackConfig((rspackConfig) => {
        // Check if publicPath or any resolve alias contains a wildcard host
        let needsFix = false;
        const publicPath = rspackConfig.output?.publicPath;
        if (typeof publicPath === 'string') {
          for (const wh of WILDCARD_HOSTS) {
            if (publicPath.includes(`//${wh}:`)) { needsFix = true; break; }
          }
        }
        if (!needsFix) {
          const aliases = rspackConfig.resolve?.alias;
          if (aliases && typeof aliases === 'object' && !Array.isArray(aliases)) {
            for (const val of Object.values(aliases)) {
              if (typeof val === 'string') {
                for (const wh of WILDCARD_HOSTS) {
                  if (val.includes(`hostname=${wh}`)) { needsFix = true; break; }
                }
              }
              if (needsFix) break;
            }
          }
        }
        if (!needsFix) return;

        const lanIP = detectLanIPv4();
        const replaceWildcard = (s: string): string => {
          for (const wh of WILDCARD_HOSTS) {
            s = s.replaceAll(`//${wh}:`, `//${lanIP}:`);
            s = s.replaceAll(`hostname=${wh}`, `hostname=${lanIP}`);
          }
          return s;
        };

        // Fix output.publicPath (used for hot-update fetch URLs)
        if (rspackConfig.output) {
          rspackConfig.output.publicPath = replaceWildcard(
            rspackConfig.output.publicPath as string,
          );
        }

        // Fix the resolve alias for @lynx-js/webpack-dev-transport/client
        // which embeds hostname=0.0.0.0 in query params for the WebSocket URL
        const aliases = rspackConfig.resolve?.alias;
        if (aliases && typeof aliases === 'object' && !Array.isArray(aliases)) {
          for (const [key, val] of Object.entries(aliases)) {
            if (typeof val === 'string') {
              const fixed = replaceWildcard(val);
              if (fixed !== val) {
                (aliases as Record<string, string>)[key] = fixed;
              }
            }
          }
        }

        // Fix ASSET_PREFIX in DefinePlugin definitions — these are stringified
        // JSON values so the wildcard appears inside quoted strings.
        for (const plugin of rspackConfig.plugins ?? []) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const defs = (plugin as any)?.definitions ?? (plugin as any)?._args?.[0];
          if (!defs || typeof defs !== 'object') continue;
          for (const [k, v] of Object.entries(defs)) {
            if (typeof v === 'string' && WILDCARD_HOSTS.has(extractHost(v))) {
              (defs as Record<string, string>)[k] = replaceWildcard(v);
            } else if (typeof v === 'object' && v !== null) {
              for (const [k2, v2] of Object.entries(v as Record<string, string>)) {
                if (typeof v2 === 'string' && WILDCARD_HOSTS.has(extractHost(v2))) {
                  (v as Record<string, string>)[k2] = replaceWildcard(v2);
                }
              }
            }
          }
        }

        // Fix SourceMapDevToolPlugin publicPath
        for (const plugin of rspackConfig.plugins ?? []) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const opts = (plugin as any)?._options ?? (plugin as any)?._args?.[0];
          if (opts && typeof opts.publicPath === 'string') {
            opts.publicPath = replaceWildcard(opts.publicPath);
          }
        }
      });

      // Wire CSS handling — forces extraction via @lynx-js/css-extract-webpack-plugin,
      // strips lightningcss, and configures ignore-css-loader for main-thread layer.
      applyCSS(api, {
        enableCSSSelector: _enableCSSSelector,
        enableCSSInvalidation: _enableCSSInheritance,
      });

      // Wire dual-thread entry splitting (worklets skipped in v1)
      await applyEntry(api, {
        debugInfoOutside: _debugInfoOutside,
        enableCSSInheritance: _enableCSSInheritance,
        customCSSInheritanceList: _customCSSInheritanceList,
      });

      // Wire @sigx/lynx-icons — reads iconSets from signalx.config.ts,
      // scans the project for <Icon> usage, and aliases the runtime's
      // virtual-module subpaths to generated codepoint / SVG maps.
      // Safe to call unconditionally; bails out when no iconSets are
      // configured or @sigx/lynx-cli isn't installed.
      await applyIcons(api);
    },
  };
}
