/**
 * One-call setup, à la `Sentry.init()`. Call once in your app entry.
 *
 * @example
 * ```ts
 * import { initObservability } from '@sigx/lynx-observability';
 *
 * initObservability({
 *     level: 'warn',                              // optional: override the default level
 *     captureErrors: true,                        // default: capture uncaught errors
 *     sink: { url: 'https://logs.example.com/ingest', headers: { 'x-api-key': KEY } },
 *     memory: { intervalMs: 60_000 },             // optional: periodic engine memory readings
 * });
 * ```
 */
import { addTransport, setLogLevel, type LogLevelName } from '@sigx/lynx-core';
import { createHttpSink, type HttpSinkOptions } from './http-sink.js';
import { installErrorCapture, type ErrorCaptureOptions } from './error-capture.js';
import { Memory, type MemoryReportingOptions } from './memory.js';

export interface ObservabilityOptions {
    /** Override the global log level (e.g. `'warn'` in production). */
    level?: LogLevelName;
    /** Remote sink to forward records to. Omit for error-capture only. */
    sink?: HttpSinkOptions;
    /** Capture uncaught errors / unhandled rejections. Default `true`. */
    captureErrors?: boolean;
    /** Options for {@link installErrorCapture} (e.g. an extra `onError` hook). */
    errorCapture?: ErrorCaptureOptions;
    /**
     * Periodic engine memory readings, logged under the `memory` namespace.
     * Presence enables it — the same convention `sink` already uses — so `{}`
     * is "on, with the defaults". Omit to leave it off.
     */
    memory?: MemoryReportingOptions;
}

/**
 * Wire up logging level, an optional remote sink, error capture, and the
 * optional memory reporter in one call.
 *
 * Returns `void` rather than a disposer on purpose: everything here is meant to
 * live for the process. Callers who need to stop a reporter should start it
 * themselves — `Memory.startReporting()` returns one.
 */
export function initObservability(opts: ObservabilityOptions = {}): void {
    if (opts.level) setLogLevel(opts.level);
    if (opts.sink) addTransport(createHttpSink(opts.sink));
    if (opts.captureErrors !== false) installErrorCapture(opts.errorCapture);
    if (opts.memory) Memory.startReporting(opts.memory);
}
