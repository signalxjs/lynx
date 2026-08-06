/**
 * Native → JS audio event channels (`onEnd`, `onMeter`).
 *
 * The native side posts to `GlobalEventEmitter` on per-id channels. The
 * subscription itself is core's `subscribeNative`: this package used to carry
 * its own copy of that shim — one of sixteen in the repo — each independently
 * re-deriving the emitter lookup, the string-or-object payload parse, the
 * listener-throws guard and the off-device fallback. See CONVENTIONS.md C7.
 *
 * Adopting it also makes the returned disposer idempotent, which is what fixes
 * the metering reference-count bug in `handles.ts`.
 */
import { subscribeNative } from '@sigx/lynx-core';

/** Subscribe to a per-id audio channel. Returns an idempotent unsubscribe. */
export function subscribe<T>(channel: string, cb: (event: T) => void): () => void {
    return subscribeNative<T>(channel, cb, { namespace: 'lynx-audio' });
}

export const PLAYER_END_CHANNEL = (id: number) => `__sigxAudioEnd:${id}`;
/** Session-wide, not per-id — an interruption affects the whole session. */
export const INTERRUPTION_CHANNEL = '__sigxAudioInterruption';
export const RECORDER_METER_CHANNEL = (id: number) => `__sigxAudioMeter:${id}`;
