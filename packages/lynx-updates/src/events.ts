/**
 * Native → JS event channel for the Updates module.
 *
 * The emitter plumbing (payload-may-be-a-JSON-string, listener-threw
 * containment, off-device no-op, idempotent disposer) lives in
 * `subscribeNative` from `@sigx/lynx-core` — convention C7. All that is left
 * here is this channel's own wire contract: which payloads are valid, and how
 * a valid payload normalises into `NativeUpdatesEvent`.
 *
 * Wire shape:
 *   { kind: 'progress', receivedBytes: number, totalBytes?: number }
 *   { kind: 'foreground' }
 */

import { subscribeNative } from '@sigx/lynx-core';

const EVENT_CHANNEL = '__sigxUpdatesEvent';

export type NativeUpdatesEvent =
    | { kind: 'progress'; receivedBytes: number; totalBytes: number | null }
    | { kind: 'foreground' };

/**
 * The payload as native sends it, before normalisation. `totalBytes` is
 * deliberately `unknown`: Android omits it for chunked responses and iOS has
 * been seen sending -1 for "unknown length", so the guard admits the event and
 * `normalize` decides what a usable total is.
 */
type RawUpdatesEvent =
    | { kind: 'foreground' }
    | { kind: 'progress'; receivedBytes: number; totalBytes?: unknown };

function isRawUpdatesEvent(raw: unknown): raw is RawUpdatesEvent {
    if (!raw || typeof raw !== 'object') return false;
    const event = raw as Record<string, unknown>;
    if (event['kind'] === 'foreground') return true;
    // A progress event without a byte count would render as NaN in the
    // progress UI, so it is malformed rather than merely incomplete.
    return event['kind'] === 'progress' && typeof event['receivedBytes'] === 'number';
}

function normalize(raw: RawUpdatesEvent): NativeUpdatesEvent {
    if (raw.kind === 'foreground') return { kind: 'foreground' };
    return {
        kind: 'progress',
        receivedBytes: raw.receivedBytes,
        // `null` means "unknown total" to consumers (indeterminate progress);
        // a missing or negative total must not become a denominator.
        totalBytes:
            typeof raw.totalBytes === 'number' && raw.totalBytes >= 0 ? raw.totalBytes : null,
    };
}

/** Subscribe to native download-progress / foreground events. @internal */
export function addNativeUpdatesListener(
    cb: (event: NativeUpdatesEvent) => void,
): () => void {
    return subscribeNative<RawUpdatesEvent>(
        EVENT_CHANNEL,
        (raw) => {
            cb(normalize(raw));
        },
        { validate: isRawUpdatesEvent, namespace: 'lynx-updates' },
    );
}

export const __EVENT_CHANNEL_FOR_TESTS = EVENT_CHANNEL;
