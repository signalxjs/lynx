# @sigx/lynx-network
Network connectivity status for sigx-lynx. `NWPathMonitor` on iOS, `ConnectivityManager` on Android.

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/network/overview/](https://sigx.dev/lynx/modules/network/overview/)**

## Install
```bash
pnpm add @sigx/lynx-network
```
`sigx prebuild` auto-discovers and links the native module. No special permissions on either platform.
## Usage
```ts
import { Network } from '@sigx/lynx-network';
const state = await Network.getState();
if (state.isConnected && state.type === 'wifi') {
    // sync large payload
}
```
## API
| Method                                | Notes                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `getState(): Promise<NetworkState>`   | Single async snapshot — no subscription stream yet.                                                |
| `isAvailable(): boolean`              | Whether the native module is registered in the current build.                                      |
```ts
type ConnectionType = 'wifi' | 'cellular' | 'ethernet' | 'bluetooth' | 'none' | 'unknown';
interface NetworkState {
    isConnected: boolean;
    type: ConnectionType;
    isInternetReachable: boolean | null;   // null = unknown (e.g. captive portal)
}
```
## Web

On web the state comes from the browser: `isConnected` / `isInternetReachable` from `navigator.onLine`, and `type` from `navigator.connection.type` where the browser exposes it (Chromium; elsewhere it reports `'unknown'`, or `'none'` when offline).

## Gotchas
- **`isInternetReachable: null`** means the OS hasn't confirmed actual reachability — common on captive-portal Wi-Fi (you're connected to an AP but can't reach the internet without sign-in). Treat as "probably yes".
- **No subscription API yet.** If you need to react to connectivity changes live, poll `getState()` from a `setInterval` or wrap a small effect — the native publisher exists but isn't surfaced as JS events in this version.
