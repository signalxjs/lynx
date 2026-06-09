# @sigx/lynx-observability

Opt-in **production error capture** and **provider-agnostic log/error sinks** for sigx-lynx. Builds on the logger in [`@sigx/lynx-core`](https://github.com/signalxjs/lynx/tree/main/packages/lynx-core#logging): uncaught errors are funneled in as `error`-level records, and a "sink" is just a `LogTransport`. No hard dependency on any vendor SDK.

> Logging itself ships in the framework (`import { createLogger } from '@sigx/lynx'`). This package adds the *production* pieces — catching crashes and shipping records off-device — and is installed only when you want them.

## Install

```sh
pnpm add @sigx/lynx-observability
```

## Quick start

Call once in your app entry (same shape as `Sentry.init()`):

```ts
import { initObservability } from '@sigx/lynx-observability';

initObservability({
    level: 'warn',                    // optional: override the default level in production
    captureErrors: true,              // default — catch uncaught errors / rejections
    sink: {                           // optional remote sink
        url: 'https://logs.example.com/ingest',
        headers: { 'x-api-key': API_KEY },
        sampleRate: 0.25,             // keep 25% of non-error records; errors always kept
    },
});
```

That's it: uncaught errors now flow to your logs (and the `sigx dev` terminal in development), and records at/above the level are batched and POSTed to your endpoint.

## Pieces (compose them yourself)

- **`installErrorCapture(opts?)`** — registers Lynx's `lynx.onError` (background thread) plus `globalThis` `error`/`unhandledrejection` handlers, normalizes whatever was thrown into an `Error`, and logs it at `error` level under the `uncaught` namespace. The `Error` rides in the record's `fields`, so transports can treat it as an exception (with a stack). Idempotent; returns an uninstall function.
- **`createHttpSink(opts)`** — a batching `LogTransport` that POSTs `{ records: [...] }` as JSON to `opts.url`. Options: `batchSize`, `flushIntervalMs`, `sampleRate`, `minLevel`, `headers`, `excludeNamespaces`. `Error` fields are serialized to `{ name, message, stack }`. It excludes the `http` namespace by default (its own POSTs log there) and swallows its own send failures, so it can't feed back into itself. Has a `.flush()` for graceful shutdown.
- **`toError(value)`** — the normalization helper, exported for reuse.

```ts
import { addTransport } from '@sigx/lynx';
import { createHttpSink, installErrorCapture } from '@sigx/lynx-observability';

addTransport(createHttpSink({ url, minLevel: 'info' }));
const uninstall = installErrorCapture({ onError: (e) => myAnalytics.track('crash', e.message) });
```

## Wire format

The sink POSTs:

```json
{ "records": [ { "level": "error", "namespace": "uncaught", "msg": "[lynx] …", "fields": [ { "name": "TypeError", "message": "…", "stack": "…" } ], "ts": 1733740000000 } ] }
```

## Provider adapters

There's no built-in vendor coupling — any provider is a `LogTransport`. Errors arrive as `error`-level records with the `Error` in `fields[0]`, so an adapter can split exceptions from breadcrumbs. Example **Sentry** adapter (Sentry is an optional peer in *your* app, not a dependency of this package):

```ts
import * as Sentry from '@sentry/browser'; // your app's dep
import { addTransport, installErrorCapture, type LogRecord } from '@sigx/lynx';

Sentry.init({ dsn: SENTRY_DSN });

addTransport((r: LogRecord) => {
    const err = r.fields.find((f) => f instanceof Error) as Error | undefined;
    if (r.level.name === 'error' && err) {
        Sentry.captureException(err);
    } else {
        Sentry.addBreadcrumb({ category: r.namespace, message: r.msg, level: r.level.name });
    }
});
installErrorCapture();
```

The same shape works for Datadog, a custom backend, etc.

## Notes

- `lynx.onError` is **background-thread only** upstream; main-thread error capture may need a separate path in the future.
- For readable stack traces in release builds, upload your source maps to your provider (out of scope here).
- Declarative configuration (`logging` in `signalx.config.ts`, auto-wired by the build plugin) is planned as a follow-up; today you call `initObservability()` from your app entry.
