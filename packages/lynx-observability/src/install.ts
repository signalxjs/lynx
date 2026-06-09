/**
 * Auto-installed by `@sigx/lynx-plugin` in **release** builds when the app's
 * `signalx.config.ts` declares `logging.production`. Prepended to the BG entry
 * so error capture + the remote sink are wired before app code runs.
 *
 * Never import this directly from app code — it has unconditional side effects.
 * To set up observability manually instead, call `initObservability(...)`.
 */
import { initObservability } from './init.js';
import type { HttpSinkOptions } from './http-sink.js';

// Injected by `@sigx/lynx-plugin` (source.define) from `logging.production`.
// `null` when unset; `typeof`-guarded so this is safe if the define didn't run.
declare const __SIGX_OBSERVABILITY_CONFIG__:
    | { sink?: HttpSinkOptions; captureErrors?: boolean }
    | null
    | undefined;

try {
    const cfg = typeof __SIGX_OBSERVABILITY_CONFIG__ !== 'undefined' ? __SIGX_OBSERVABILITY_CONFIG__ : null;
    if (cfg) {
        initObservability({ sink: cfg.sink, captureErrors: cfg.captureErrors });
    }
} catch {
    // Never let observability wiring crash the host app.
}
