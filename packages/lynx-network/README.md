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
| `getState(): Promise<NetworkState>`   | Single async snapshot — no subscription stream yet. **Rejects** if the native side fails.           |
| `isAvailable(): boolean`              | Whether the native module is registered in the current build.                                      |
```ts
type ConnectionType = 'wifi' | 'cellular' | 'ethernet' | 'bluetooth' | 'none' | 'unknown';
interface NetworkState {
    isConnected: boolean;
    type: ConnectionType;
    isInternetReachable: boolean | null;   // null = unknown (e.g. captive portal)
}
```

### Errors

`getState()` throws a `SigxError` from `@sigx/lynx-core` when the native side reports a failure — `code: 'native_error'`, message `[@sigx/lynx-network] getState failed: <cause>`, raw native payload on `cause`. Branch on `code`, never on the message. It also throws when the native module isn't linked into the build; feature-detect with `isAvailable()` rather than catching that.

A failure is never reported as "offline", so an `isConnected: false` result can be trusted by an offline banner.

```ts
import { isSigxError } from '@sigx/lynx-core';

try {
    const state = await Network.getState();
} catch (e) {
    if (isSigxError(e) && e.code === 'native_error') {
        // couldn't read connectivity — not the same as being offline
    }
}
```

## Web

On web the state comes from the browser: `isConnected` / `isInternetReachable` from `navigator.onLine`, and `type` from `navigator.connection.type` where the browser exposes it (Chromium; elsewhere it reports `'unknown'`, or `'none'` when offline). The browser path has no failure envelope, so it never throws.

## Gotchas
- **A native failure throws, it does not resolve.** The native `{ error }` envelope used to be handed back as a `NetworkState` with every field `undefined`, so `if (state.isConnected)` quietly took the offline branch and no `catch` ever ran. Callers written against that degraded shape now need a `catch`.
- **`isInternetReachable: null`** means the OS hasn't confirmed actual reachability — common on captive-portal Wi-Fi (you're connected to an AP but can't reach the internet without sign-in). Treat as "probably yes".
- **No subscription API yet, and no native publisher behind one either.** To react to connectivity changes live, poll `getState()` from a `setInterval` or a small effect. There is nothing to subscribe to today: Android registers no `NetworkCallback` at all, and iOS's `NWPathMonitor` only caches the latest path for the next `getState()` — neither ever calls `sendGlobalEvent`. A `Network.subscribe()` + `useNetwork()` pair, backed by a real publisher on both platforms, is tracked on [#894](https://github.com/signalxjs/lynx/issues/894).
