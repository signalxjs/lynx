/**
 * The native → JS safe-area event channel.
 *
 * The subscription itself is core's `subscribeNative` (CONVENTIONS.md C7).
 * This package used to carry its own copy of that shim — one of sixteen in the
 * repo — each independently re-deriving the `lynx.getJSModule` lookup, the
 * string-or-object payload parse, the listener-throws guard and the off-device
 * fallback. Two of those four were missing here; see the notes on
 * `subscribeSafeArea` below.
 */
import { subscribeNative } from '@sigx/lynx-core';
import type { RawSafeAreaProps } from './globals.js';
import type { EdgeInsets } from './types.js';

/**
 * The native publisher (iOS `SafeAreaPublisher.swift`, Android
 * `SafeAreaPublisher.kt`) emits this event via `GlobalEventEmitter` every
 * time it republishes insets. Payload mirrors the same `RawSafeAreaProps`
 * shape stored under `lynx.__globalProps[GLOBAL_PROPS_KEY]`.
 *
 * We use a custom event rather than upstream's `onGlobalPropsChanged` so
 * the contract stays in our hands (upstream's event-name conventions have
 * churned across Lynx releases).
 */
export const SAFE_AREA_EVENT = 'safeAreaChanged';

const INSET_KEYS = [
    'top',
    'right',
    'bottom',
    'left',
    'keyboard',
    'statusBar',
    'navigationBar',
] as const satisfies readonly (keyof RawSafeAreaProps)[];

/**
 * Payload guard for `subscribeNative`.
 *
 * Requires a plain object carrying at least one finite numeric inset key. The
 * hand-rolled listener took the same non-object payloads and "normalised" them
 * into the *current* insets, then wrote those values straight back — a
 * self-assignment that looked like a successful update. Dropping the event is
 * the honest outcome: there is nothing in it to apply.
 */
export function isRawSafeAreaProps(raw: unknown): raw is RawSafeAreaProps {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const o = raw as Record<string, unknown>;
    return INSET_KEYS.some((k) => typeof o[k] === 'number' && Number.isFinite(o[k]));
}

/**
 * Subscribe to `safeAreaChanged`. Returns an **idempotent** unsubscribe
 * (`() => void`, never `{ remove() }` — C7), safe to use directly as an
 * effect cleanup.
 *
 * Two things the previous hand-rolled listener got wrong, both silent:
 *
 * - **A JSON-string payload was ignored.** Hosts that serialise
 *   `GlobalEventEmitter` params (the Lynx web host, and any bridge that
 *   stringifies) delivered the insets as a string; `typeof raw !== 'object'`
 *   sent it down the fallback path, so insets froze at their cold-start seed
 *   forever with no error anywhere. `subscribeNative` parses first.
 *
 * - **A throwing listener took the emitter down.** Applying an event writes a
 *   sigx signal, and sigx runs consumer effects *synchronously* on write — so
 *   one buggy `useSafeAreaInsets()` consumer unwound straight out of the
 *   listener into the native dispatch loop, cancelling `safeAreaChanged`
 *   delivery for every other listener on the channel. `subscribeNative`
 *   contains it and warns under this package's namespace (C10).
 */
export function subscribeSafeArea(cb: (raw: RawSafeAreaProps) => void): () => void {
    return subscribeNative<RawSafeAreaProps>(SAFE_AREA_EVENT, cb, {
        namespace: 'lynx-safe-area',
        validate: isRawSafeAreaProps,
    });
}

/**
 * Fill an `EdgeInsets` from a validated payload, keeping the current value for
 * any edge the platform omitted (Android pre-31 has no navigation-bar API).
 */
export function normaliseInsets(raw: RawSafeAreaProps, fallback: EdgeInsets): EdgeInsets {
    const o = raw as Record<string, unknown>;
    return {
        top: numOr(o['top'], fallback.top),
        right: numOr(o['right'], fallback.right),
        bottom: numOr(o['bottom'], fallback.bottom),
        left: numOr(o['left'], fallback.left),
        keyboard: numOr(o['keyboard'], fallback.keyboard),
        statusBar: numOr(o['statusBar'], fallback.statusBar),
        navigationBar: numOr(o['navigationBar'], fallback.navigationBar),
    };
}

function numOr(v: unknown, fallback: number): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
