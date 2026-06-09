/**
 * @sigx/lynx-observability — opt-in production error capture + provider-agnostic
 * log/error sinks for sigx-lynx.
 *
 * Builds on the `@sigx/lynx-core` logger: uncaught errors are funneled in as
 * `error`-level records, and sinks are just `LogTransport`s. Call
 * {@link initObservability} once in your app entry, or compose the pieces
 * ({@link installErrorCapture}, {@link createHttpSink}) yourself.
 *
 * @packageDocumentation
 */
export { initObservability } from './init.js';
export type { ObservabilityOptions } from './init.js';
export { installErrorCapture, toError } from './error-capture.js';
export type { ErrorCaptureOptions } from './error-capture.js';
export { createHttpSink } from './http-sink.js';
export type { HttpSink, HttpSinkOptions } from './http-sink.js';
