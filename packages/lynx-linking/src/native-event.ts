/**
 * The package's single native-event subscription (C7).
 *
 * A thin adapter over `subscribeNative()` from `@sigx/lynx-core`, not a
 * re-implementation: this package's two channels are the reason core's helper
 * grew a `raw` option, and both shapes were verified against native rather
 * than assumed.
 *
 *  - **`urlReceived` delivers the URL as a bare string.** Native fires
 *    `sendGlobalEvent("urlReceived", [url])` (`android/…/LinkingPublisher.kt`,
 *    `ios/LinkingPublisher.swift`) and `@sigx/lynx-web-host` fires
 *    `sendGlobalEvent('urlReceived', [location.href])`. Core's default treats
 *    every string payload as JSON, so `JSON.parse('myapp://deep/link')` throws
 *    and the event is dropped — every warm-start deep link swallowed, silently.
 *  - **`hardwareBackPress` carries no payload at all.** Native fires it with an
 *    empty `JavaOnlyArray()`, so the listener is called with no arguments, and
 *    core's default drops an `undefined` payload before the callback runs —
 *    the Android back button would go dead.
 *
 * `raw: true` turns both of those off, which is exactly what these channels
 * need. Everything else — the emitter lookup, the idempotent `() => void`
 * disposer, listener-throw containment reported through the package logger
 * (C10), and the safe no-op off-device — comes from core.
 */
import { subscribeNative } from '@sigx/lynx-core';

/**
 * Subscribe to a channel whose payload is *not* a JSON object.
 *
 * @param channel the `GlobalEventEmitter` channel name
 * @param cb called with the payload exactly as native sent it — a bare string
 *           for `urlReceived`, `undefined` for `hardwareBackPress`
 * @returns unsubscribe; calling it more than once is a no-op
 */
export function subscribeRawNative(channel: string, cb: (raw: unknown) => void): () => void {
    return subscribeNative<unknown>(channel, cb, { raw: true, namespace: 'lynx-linking' });
}
