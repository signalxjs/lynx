/**
 * Web implementation (runs in `@lynx-js/web-core`'s Worker): network state
 * from `navigator.onLine` + (where the browser exposes it)
 * `navigator.connection.type`. Swapped in by the plugin's `.web.js`
 * `extensionAlias` (signalxjs/lynx#697); the native bridge tree-shakes away.
 * Worker scope only — no `window.` / `document.`.
 */
import type { ConnectionType, NetworkState } from './network.js';

export type { ConnectionType, NetworkState } from './network.js';

interface WorkerNavigator {
  onLine?: boolean;
  connection?: { type?: string };
}

const KNOWN_TYPES: ReadonlySet<string> = new Set([
  'wifi',
  'cellular',
  'ethernet',
  'bluetooth',
  'none',
  'unknown',
]);

function nav(): WorkerNavigator | undefined {
  return (globalThis as { navigator?: WorkerNavigator }).navigator;
}

export const Network: typeof import('./network.js').Network = {
  getState(): Promise<NetworkState> {
    const n = nav();
    const online = n?.onLine ?? true; // absent onLine = assume connected
    const raw = n?.connection?.type;
    const type: ConnectionType = !online
      ? 'none'
      : raw && KNOWN_TYPES.has(raw)
        ? (raw as ConnectionType)
        : 'unknown';
    return Promise.resolve({
      isConnected: online,
      type,
      // `onLine` is the browser's own reachability signal — unlike the native
      // module we have no separate probe, so it doubles as reachability.
      isInternetReachable: online,
    });
  },

  isAvailable(): boolean {
    return typeof nav() !== 'undefined';
  },
} as const;
