# @sigx/lynx-observability

Opt-in **production error capture**, **engine memory telemetry** and **provider-agnostic log/error sinks** for sigx-lynx. Builds on the logger in [`@sigx/lynx-core`](https://sigx.dev/lynx/modules/core/overview/): uncaught errors are funneled in as `error`-level records, memory readings as ordinary records, and a "sink" is just a `LogTransport`. No hard dependency on any vendor SDK.

> Logging itself ships in the framework (`import { createLogger } from '@sigx/lynx'`). This package adds the *production* pieces — catching crashes, measuring what the engine is holding, and shipping records off-device — and is installed only when you want them.

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/](https://sigx.dev/lynx/)**

## Install

```sh
pnpm add @sigx/lynx-observability
```

This package ships native code, so after installing it run:

```sh
sigx prebuild
```

## Usage

Declare it in `signalx.config.ts` and it auto-wires in **release** builds — no code in your app entry:

```ts
// signalx.config.ts
export default defineLynxConfig({
    name: 'my-app',
    logging: {
        level: 'warn',                      // logger level (dev defaults to 'debug', release to 'warn')
        namespaces: { disabled: ['http'] }, // silence namespaces at startup
        production: {
            sink: { url: 'https://logs.example.com/ingest', headers: { 'x-api-key': KEY }, sampleRate: 0.25 },
            captureErrors: true,            // default
        },
    },
});
```

`@sigx/lynx-plugin` prepends the init for you in release builds — installing the package is all that's needed. (Dev uses the console streamer; observability auto-wiring is release-only.)

Or wire it yourself, `Sentry.init()`-style, once in your app entry:

```ts
import { initObservability } from '@sigx/lynx-observability';

initObservability({
    level: 'warn',
    captureErrors: true,              // default — catch uncaught errors / rejections
    sink: {
        url: 'https://logs.example.com/ingest',
        headers: { 'x-api-key': API_KEY },
        sampleRate: 0.25,             // keep 25% of non-error records; errors always kept
    },
});
```

Ask what the engine is holding right now:

```ts
import { Memory } from '@sigx/lynx-observability';

const m = await Memory.query();
console.log(`${(m.totalBytes / 1e6).toFixed(1)} MB of ${(m.appBytes / 1e6).toFixed(1)} MB app`);
for (const i of m.instances) {
    console.log(`  ${i.url}: ${i.elementNodeCount} nodes, ${(i.elementBytes / 1e6).toFixed(1)} MB`);
}
```

`elementBytes` against `elementNodeCount` is the pairing worth watching — it's what turns "the screen went blank" into "we're mounting 12,000 nodes".

Or let it sample itself:

```ts
const stop = Memory.startReporting({ intervalMs: 60_000 });
```

Each reading is logged under the `memory` namespace, so it shows up in the `sigx dev` terminal in development and reaches your sink in production with no extra wiring. Same thing declaratively, via `logging.production.memory` in `signalx.config.ts`.

## API

### `Memory`

| Member | Type | Notes |
|---|---|---|
| `Memory.query(options?)` | `Promise<MemoryUsageSnapshot>` | One process-global reading. Throws if the native module isn't linked, or on an engine failure. |
| `Memory.startReporting(options?)` | `() => void` | Sample on a timer and log each reading under the `memory` namespace. Returns an unsubscribe. **No-ops instead of throwing** when unavailable — see Gotchas. |
| `Memory.isAvailable()` | `boolean` | Is the native module linked in this build? |

`MemoryReportingOptions` extends `MemoryQueryOptions` with:

| Field | Type | Default | Notes |
|---|---|---|---|
| `intervalMs` | `number` | `60000` | Gap between the **end** of one reading and the start of the next, so a slow query can't stack collections. |
| `level` | `Exclude<LogLevelName, 'silent'>` | `'info'` | Level each reading is logged at. `'silent'` is a threshold, not a level — omit the block to turn reporting off. |
| `immediate` | `boolean` | `true` | Take a reading straight away rather than waiting one interval. |
| `maxInstances` | `number` | `5` | Per-instance rows carried in the record; `0` omits them. Caps record size on an app with many LynxViews. |
| `onReading` | `(s: MemoryUsageSnapshot) => void` | — | Extra per-reading hook. Throwing won't stop the loop. |

`MemoryQueryOptions`:

| Field | Type | Default | Notes |
|---|---|---|---|
| `timeoutMs` | `number` | engine default (2000) | How long the engine waits for every instance. `<= 0` also means the default. A short timeout doesn't fail — it returns a partial result. |

`MemoryUsageSnapshot`:

| Field | Type | Notes |
|---|---|---|
| `collectionStatus` | `'completed' \| 'timeout' \| 'unknown'` | `'timeout'` means the aggregates below are **partial**. |
| `collectionStartMs` / `collectionDurationMs` / `collectionTimeoutMs` | `number` | Wall-clock start, elapsed time, and the timeout applied — all ms. |
| `expectedInstanceCount` / `completedInstanceCount` | `number` | Live instances at request start, vs. those that reported in time. |
| `totalBytes` | `number` | Lynx-attributed total. Excludes `appBytes`; shared runtimes counted once. |
| `appBytes` | `number` | The app's whole physical footprint. |
| `ratioToApp` | `number` | `totalBytes / appBytes`, or `0` when `appBytes` couldn't be sampled. |
| `elementBytes` / `elementNodeCount` | `number` | Element tree, summed over completed instances. |
| `viewBytes` | `number` | Platform UI memory, summed over completed instances. |
| `mainThreadRuntimeBytes` / `backgroundThreadRuntimeBytes` | `number` | Runtime heaps, sampled without forcing a GC. Shared background runtimes are deduplicated in the total. |
| `instances` | `MemoryInstanceUsage[]` | Completed instances, sorted by `totalBytes` descending. |

`MemoryInstanceUsage` carries the same per-LynxView figures plus `instanceId` (`null` when the instance was never fully attached), `pageId`, `url`, and `btsRuntimeGroupId`.

### Error capture and sinks

| Export | Type | Notes |
|---|---|---|
| `initObservability(options?)` | `void` | One-call setup: level, sink, error capture. |
| `installErrorCapture(options?)` | `() => void` | Registers `lynx.onError` plus `globalThis` `error`/`unhandledrejection`, normalizes what was thrown, and logs it at `error` level under the `uncaught` namespace with the `Error` in `fields`. Idempotent; returns an uninstall. |
| `createHttpSink(options)` | `HttpSink` | A batching `LogTransport` that POSTs `{ records: [...] }` as JSON. Options: `batchSize`, `flushIntervalMs`, `sampleRate`, `minLevel`, `headers`, `excludeNamespaces`. Has a `.flush()` for graceful shutdown. |
| `toError(value)` | `Error` | The normalization helper, exported for reuse. |

```ts
import { addTransport } from '@sigx/lynx';
import { createHttpSink, installErrorCapture } from '@sigx/lynx-observability';

addTransport(createHttpSink({ url, minLevel: 'info' }));
const uninstall = installErrorCapture({ onError: (e) => myAnalytics.track('crash', e.message) });
```

The sink's wire format:

```json
{ "records": [ { "level": "error", "namespace": "uncaught", "msg": "[lynx] …", "fields": [ { "name": "TypeError", "message": "…", "stack": "…" } ], "ts": 1733740000000 } ] }
```

There's no vendor coupling — any provider is a `LogTransport`. Errors arrive as `error`-level records with the `Error` in `fields`, so an adapter can split exceptions from breadcrumbs:

```ts
import * as Sentry from '@sentry/browser'; // your app's dep, not ours
import { addTransport, installErrorCapture, type LogRecord } from '@sigx/lynx';

Sentry.init({ dsn: SENTRY_DSN });
addTransport((r: LogRecord) => {
    const err = r.fields.find((f) => f instanceof Error) as Error | undefined;
    if (r.level.name === 'error' && err) Sentry.captureException(err);
    else Sentry.addBreadcrumb({ category: r.namespace, message: r.msg, level: r.level.name });
});
installErrorCapture();
```

The same shape works for Datadog, a custom backend, and so on.

## Web

| Surface | Web |
|---|---|
| `initObservability`, `installErrorCapture`, `createHttpSink`, `toError` | **Supported.** Error capture uses the `globalThis` handlers; the sink POSTs through `@sigx/lynx-http`. |
| `Memory.query()` | **Unsupported** — rejects with a `SigxError` (`code: 'unsupported'`). |
| `Memory.startReporting()` | **No-op**, returning a no-op disposer. |
| `Memory.isAvailable()` | Returns `false`. |

There is no Lynx engine in a web build, so there is no element tree, no UI owner and no main/background runtime split to attribute memory to. Chromium's non-standard `performance.memory` reports the JS heap and nothing else; mapping it into `totalBytes` would put a number in your dashboard that looks comparable to the native one and isn't. Guard the call with `Memory.isAvailable()` if your code runs on both.

## Gotchas

- **`Memory` requires Lynx ≥ 4.0.1**, and a `sigx prebuild` after installing this package. There is no manifest field for a minimum engine version yet, so an older pin fails at native compile time with an unhelpful message rather than a clear one.
- **Installing this package changes your OTA runtime fingerprint**, because it adds native sources. Re-run `sigx prebuild`, cut a store release, and republish your update bundles.
- **A memory reading is process-global.** One query covers every LynxView; there is no per-view query. Use `instances` to attribute.
- **`collectionStatus: 'timeout'` is a partial result, not an error.** `query()` resolves normally. Compare `completedInstanceCount` against `expectedInstanceCount` before trusting a delta between two readings — a smaller total may just mean one instance didn't report.
- **Summed instance bytes can exceed the global total, by design.** Instances sharing a `btsRuntimeGroupId` share one background runtime, and the global figure counts those bytes once.
- **Not every field is populated on both platforms.** The engine fills these in per-platform, and we pass through what it gives us rather than inventing a value. Measured on release builds (Pixel / iOS 26 simulator, Lynx 4.0.1):

  | Field | Android | iOS |
  |---|---|---|
  | `totalBytes`, `appBytes`, `ratioToApp` | ✅ | ✅ |
  | `elementBytes`, `elementNodeCount` | ✅ | ✅ |
  | `mainThreadRuntimeBytes` | ✅ | ✅ |
  | `backgroundThreadRuntimeBytes` | ✅ | reported `0` |
  | `viewBytes` | reported `0` | ✅ |
  | `url` | empty string | full bundle path |

  So compare a platform against itself over time, not against the other one. `totalBytes`, `elementBytes` and `elementNodeCount` — the three that matter most for diagnosing a runaway element tree — are solid on both.
- **`viewDetail` is not surfaced.** The engine reports per-view-class memory records per instance; we don't currently expose them, because the record shape isn't pinned across platforms and the aggregate plus `elementNodeCount` is what the diagnosis actually needs.
- **In a release build the global log level defaults to `warn`, so default `info` readings are dropped — and then not even collected.** This catches people out, because it looks like the feature is off. `startReporting` skips the query entirely when nothing would be emitted at its level, rather than running a process-global collection every minute to throw the result away. So if you want memory in production, either raise `logging.level` to `'info'` or set the reading's own `level: 'warn'`. (The same threshold already governs whether `createHttpSink`'s default `minLevel: 'info'` ever sees anything.) An `onReading` hook bypasses the gate — it's its own reason to sample.
- **`Memory.startReporting()` no-ops instead of throwing** when the native module isn't linked (it logs one `debug` line). It's ambient telemetry, often started before your app code runs, so a throw would take down an app whose only mistake was forgetting to re-run `sigx prebuild`. `Memory.query()` keeps the default throw — there you asked for a number and need to know you didn't get one.
- **Lynx's background-thread `PerformanceObserver` delivers nothing in a sigx-lynx app.** `lynx.performance.createObserver` exists and `observe()` succeeds, but no entry ever arrives — nor does the older `addTimingListener`. Device-verified on a release build; see #982. So there is no first-paint/FCP reporting here yet, and if you reach for the raw API yourself, expect silence rather than assuming you've held it wrong.
- **The passive `memory` performance entry never reaches JS.** Lynx does emit one, and `MemoryUsageEntry` is declared in `@lynx-js/types`, so `lynx.performance.createObserver` + `observe(['memory'])` type-checks — but the engine sends it to *platform* observers only (`kEventTypePlatform`), so you get silence on device. That is exactly why this package needs native code. Same for `jsBlocking`.
- **`lynx.onError` is background-thread only** upstream; main-thread error capture may need a separate path in the future.
- For readable stack traces in release builds, upload your source maps to your provider (out of scope here).

## License

MIT
