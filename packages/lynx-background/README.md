# @sigx/lynx-background

Periodic background tasks for sigx-lynx — iOS `BGTaskScheduler` and Android `WorkManager`.

Run JS handlers while the app is backgrounded or closed: refresh content, sync queues, pull a feed, write to storage. Pairs with `@sigx/lynx-network` and `@sigx/lynx-storage` for the typical background-fetch story.

- **iOS**: `BGAppRefreshTask` (lightweight, ~30s budget) and `BGProcessingTask` (longer, charging-aware).
- **Android**: `PeriodicWorkRequest` (15-minute minimum interval) and `OneTimeWorkRequest` via `androidx.work`.

## Install

```bash
pnpm add @sigx/lynx-background
```

`sigx prebuild` auto-discovers the package, links the native module, adds `UIBackgroundModes: fetch, processing` to iOS `Info.plist`, populates `BGTaskSchedulerPermittedIdentifiers` from the identifiers you declare, and adds the `androidx.work` dependency on Android.

> **Permitted identifiers** must be known at build time on iOS. Declare them in your app config so `sigx prebuild` can write them into `Info.plist`:

```ts
// sigx.config.ts
import { defineLynxConfig } from '@sigx/lynx-cli/config';

export default defineLynxConfig({
    ios: {
        bundleIdentifier: 'com.example.app',
        // Full reverse-DNS identifiers — by convention, namespace each task
        // as `${bundleId}.bg.${taskName}` to match what the JS API submits
        // to BGTaskScheduler.
        bgTaskIdentifiers: [
            'com.example.app.bg.refresh-feed',
            'com.example.app.bg.sync-outbox',
        ],
    },
});
```

The JS API uses the short `taskName` (e.g. `"refresh-feed"`); the native side prepends `${bundleId}.bg.` before submitting to `BGTaskScheduler`, so the entries in `bgTaskIdentifiers` must use that exact namespaced form.

## Usage

```ts
import { Background } from '@sigx/lynx-background';

// 1. Register a handler at app startup. MUST be wired before the first
//    foreground frame — the OS may fire the task before any UI is rendered
//    on a subsequent cold launch.
Background.setHandler('refresh-feed', async () => {
    const res = await fetch('https://example.com/feed.json');
    const json = await res.json();
    await Storage.set('feed', JSON.stringify(json));
});

// 2. Ask the OS to schedule it. Idempotent — call on every cold start.
await Background.register('refresh-feed', {
    minimumInterval: 15 * 60,   // 15 minutes (Android floor; iOS hint)
    requiresNetwork: true,
    requiresCharging: false,
    type: 'fetch',              // iOS only; 'fetch' (default) or 'processing'
});

// To cancel:
await Background.unregister('refresh-feed');
```

### Frequency caveats

- **iOS** — `BGTaskScheduler` is a **hint**, not a guarantee. The OS decides when (or if) to fire based on usage patterns, battery, network. Expect once every few hours at best for `BGAppRefreshTask`. `BGProcessingTask` typically fires overnight while charging.
- **Android** — `PeriodicWorkRequest` enforces a 15-minute minimum interval. Values below 15 minutes are clamped by the platform. Doze mode and battery optimization will defer firing on idle devices.

### Time budget

Handler promises **must** resolve within the platform budget:

- **iOS** — ~30 seconds total for `BGAppRefreshTask`; longer (minutes) for `BGProcessingTask`. The OS expiration handler posts `task.setTaskCompleted(success: false)` as a safety net.
- **Android** — ~10 minutes for `WorkManager`. If the JS handler doesn't resolve before the worker's internal 9-minute timeout, the worker returns `Result.retry()`, so `WorkManager` will back off and re-fire the task on its next schedule rather than marking it permanently failed.

Apps should structure handlers as small idempotent steps and let the next fire pick up where the last one left off.

## API

| Method                                              | Notes                                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `Background.register(taskName, options?)`           | Schedule the task. Idempotent.                                                                     |
| `Background.unregister(taskName)`                   | Cancel a scheduled task.                                                                           |
| `Background.setHandler(taskName, fn)`               | Set the JS handler. Returns an unsubscribe function. Call at startup, before the first `register`. |
| `Background.getRegistered()`                        | List currently-registered task names (from native persistence).                                    |
| `Background.isAvailable()`                          | Whether the native module is wired in the current build.                                           |

```ts
interface RegisterOptions {
    minimumInterval?: number;        // seconds
    requiresNetwork?: boolean;
    requiresCharging?: boolean;
    type?: 'fetch' | 'processing';   // iOS only
}
```

## Persistence

Handler registrations live in JS and must be re-wired on every cold start. The native side persists *task identifiers* (UserDefaults on iOS, SharedPreferences on Android) so it can re-submit the OS request without needing JS to be alive. The handler dispatch waits until the JS runtime is up and a handler for `taskName` has been set, with a short bounded grace period; if the handler still isn't there, the task completes as a no-op so the OS doesn't penalize the app.

## Gotchas

- **iOS simulator doesn't run `BGTaskScheduler`**. Use a real device. You can manually trigger a registered task in Xcode via the LLDB command:
    ```
    e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:@"com.example.app.bg.refresh-feed"]
    ```
- **Android battery optimization** can prevent `WorkManager` from firing on stock OEM ROMs (Xiaomi, Huawei, Oppo are the usual offenders). Ask users to allow background activity for the app or test on a Pixel.
- **`minimumInterval < 900` on Android** is silently clamped to 900 seconds (15 minutes) by `WorkManager`. Use `OneTimeWorkRequest` semantics (no `minimumInterval`) for one-shot tasks.

## Example

See `examples/showcase/` — the Settings screen wires up `Background.setHandler('refresh-feed', ...)`, exposes register/unregister buttons, and renders the last fire result. `examples/showcase/signalx.config.ts` declares the matching `ios.bgTaskIdentifiers` entry so `sigx prebuild` injects it into `Info.plist`.
