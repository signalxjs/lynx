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

`sigx prebuild` auto-discovers the package, links the native module, adds `UIBackgroundModes` to iOS, populates `BGTaskSchedulerPermittedIdentifiers` from the identifiers you declare in your app config, and adds the `androidx.work` dependency on Android. iOS task identifiers must be known at build time — declare them in `sigx.config.ts`.

## A taste

```ts
import { Background } from '@sigx/lynx-background';

// Register a handler at app startup, before the first foreground frame.
Background.setHandler('refresh-feed', async () => {
    const res = await fetch('https://example.com/feed.json');
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

## License

MIT
