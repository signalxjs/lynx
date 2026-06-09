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
 * });
 * ```
 */
import { addTransport, setLogLevel, type LogLevelName } from '@sigx/lynx-core';
import { createHttpSink, type HttpSinkOptions } from './http-sink.js';
import { installErrorCapture, type ErrorCaptureOptions } from './error-capture.js';

export interface ObservabilityOptions {
    /** Override the global log level (e.g. `'warn'` in production). */
    level?: LogLevelName;
    /** Remote sink to forward records to. Omit for error-capture only. */
    sink?: HttpSinkOptions;
    /** Capture uncaught errors / unhandled rejections. Default `true`. */
    captureErrors?: boolean;
    /** Options for {@link installErrorCapture} (e.g. an extra `onError` hook). */
    errorCapture?: ErrorCaptureOptions;
}

/** Wire up logging level, an optional remote sink, and error capture in one call. */
export function initObservability(opts: ObservabilityOptions = {}): void {
    if (opts.level) setLogLevel(opts.level);
    if (opts.sink) addTransport(createHttpSink(opts.sink));
    if (opts.captureErrors !== false) installErrorCapture(opts.errorCapture);
}
