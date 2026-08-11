# @sigx/lynx-background

Periodic background tasks for sigx-lynx — iOS `BGTaskScheduler` and Android `WorkManager`.

Run JS handlers while the app is backgrounded or closed: refresh content, sync queues, pull a feed, write to storage. Pairs with [`@sigx/lynx-network`](https://sigx.dev/lynx/modules/network/overview/) and [`@sigx/lynx-storage`](https://sigx.dev/lynx/modules/storage/overview/) for the typical background-fetch story.

- **iOS**: `BGAppRefreshTask` (lightweight, ~30s budget) and `BGProcessingTask` (longer, charging-aware).
- **Android**: `PeriodicWorkRequest` (15-minute minimum interval) and `OneTimeWorkRequest` via `androidx.work`.

## 📚 Documentation

Full API, scheduling caveats, time budgets, permitted-identifier setup and live examples → **[sigx.dev/lynx/modules/background/overview](https://sigx.dev/lynx/modules/background/overview/)**

## Install

```bash
pnpm add @sigx/lynx-background
```

`sigx prebuild` auto-discovers the package, links the native module, adds `UIBackgroundModes` to iOS, populates `BGTaskSchedulerPermittedIdentifiers` from the identifiers you declare in your app config, and adds the `androidx.work` dependency on Android. iOS task identifiers must be known at build time — declare them in `signalx.config.ts`.

## A taste

```ts
import { Background } from '@sigx/lynx-background';
import { Storage } from '@sigx/lynx-storage';

// Register a handler at app startup, before the first foreground frame.
Background.setHandler('refresh-feed', async () => {
    const res = await globalThis.fetch('https://example.com/feed.json');
    await Storage.set('feed', JSON.stringify(await res.json()));
});

// Ask the OS to schedule it. Idempotent — call on every cold start.
await Background.register('refresh-feed', {
    minimumInterval: 15 * 60,   // 15 minutes (Android floor; iOS hint)
    requiresNetwork: true,
    type: 'fetch',              // iOS only; 'fetch' (default) or 'processing'
});
```

The full API, the platform frequency/time-budget caveats, the persistence model and platform gotchas are documented on the docs site.

## Errors

`register()`, `unregister()` and `getRegistered()` **reject** when the OS refuses the request — they no longer resolve on a native failure. The rejection is a `SigxError` with `code: 'native_error'` and a message of the form `[@sigx/lynx-background] register failed: …`:

```ts
import { isSigxError } from '@sigx/lynx-core';

try {
    await Background.register('refresh-feed', { minimumInterval: 15 * 60 });
} catch (err) {
    // On iOS the usual cause is an identifier missing from
    // BGTaskSchedulerPermittedIdentifiers — the task would otherwise be
    // scheduled-looking and permanently silent.
    if (isSigxError(err)) console.error(err.code, err.message);
}
```

`setHandler()` is unaffected: a handler that throws is caught, logged, and the wake is completed as `success=false` so the OS reschedules.

## Web

**Not supported on web** (`sigx run:web`). There's no `.web.ts` implementation and `@sigx/lynx-web-host` exposes no background handler, so the native module is never registered: `isAvailable()` returns `false` and `register()` / `unregister()` / `getRegistered()` reject with the `Module "Background" is not available` error. `setHandler()` itself is harmless — the fire channel falls back to a no-op subscription when there's no native emitter — but nothing will ever call the handler.

Waking code that isn't running needs a **service worker**: Chromium's Background Sync API fires a one-off `sync` event when connectivity returns, and Periodic Background Sync (Chromium-only, and only for installed PWAs) is the closest thing to a periodic wake-up. The app's background code here runs in a plain Web Worker, not a service worker, so OS-scheduled wake-ups have no equivalent today. On web, do the work while the page is open instead — a timer plus a refresh on `visibilitychange`.

## License

MIT
