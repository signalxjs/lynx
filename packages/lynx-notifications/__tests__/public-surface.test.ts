/**
 * Public-surface freeze test for @sigx/lynx-notifications.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect, for the
 *    barrel and for the `Notifications` namespace (C1). Type-only exports
 *    (`NotificationContent`, `RemoteMessage`, `PermissionResponse`, …) are
 *    erased at runtime and are pinned below instead.
 *  - Types: the load-bearing signatures, because those are what
 *    `CONVENTIONS.md` constrains — permission methods resolve a
 *    `PermissionResponse` (C6), subscriptions return an unsubscribe (C7), and
 *    `isAvailable` has to stay synchronous (C2).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as notifications from '../src/index';
import { Notifications } from '../src/index';
import type {
    NotificationResponse,
    PermissionResponse,
    PushTokenError,
    PushTokenEvent,
    RegisterPushResult,
    RemoteMessage,
    UnregisterPushResult,
} from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(notifications).sort()).toEqual(
            [
                'Notifications',
                // The four subscriptions are exported twice — as roots and as
                // `Notifications.*` members — so consumers can chain off the
                // namespace without a second import. Both spellings are public.
                'addTokenListener',
                'addTokenErrorListener',
                'addPushListener',
                'addNotificationResponseListener',
            ].sort(),
        );
    });

    it('exposes exactly the documented methods (C1)', () => {
        // A new method reaching consumers unannounced is the thing this
        // catches; the README API table has to grow with it.
        expect(Object.keys(Notifications).sort()).toEqual(
            [
                'schedule',
                'cancel',
                'cancelAll',
                'requestPermission',
                'getPermissionStatus',
                'registerForPushNotifications',
                'unregisterForPushNotifications',
                'setBadgeCount',
                'getBadgeCount',
                'getInitialNotification',
                'addTokenListener',
                'addTokenErrorListener',
                'addPushListener',
                'addNotificationResponseListener',
                'isAvailable',
            ].sort(),
        );
    });
});

describe('public types', () => {
    it('keeps isAvailable synchronous and boolean (C2)', () => {
        // The convention most worth freezing: `Biometric.isAvailable()`
        // drifted into returning a Promise, which makes `if (isAvailable())`
        // silently always true.
        expectTypeOf(Notifications.isAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(Notifications.isAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });

    it('pins the permission methods on the shared envelope (C6)', () => {
        // Both must keep resolving the *same* core envelope — a package-local
        // status string would break callers that switch on `status` across
        // modules, and `getPermissionStatus` must stay prompt-free by contract.
        expectTypeOf(Notifications.requestPermission).toEqualTypeOf<
            () => Promise<PermissionResponse>
        >();
        expectTypeOf(Notifications.getPermissionStatus).toEqualTypeOf<
            () => Promise<PermissionResponse>
        >();
    });

    it('keeps every subscription returning an unsubscribe (C7)', () => {
        // The unsubscribe is what makes these usable from an effect; a
        // subscription that started returning void or a Promise would leak
        // listeners in every consumer with no compile error at the call site.
        expectTypeOf(notifications.addTokenListener).toEqualTypeOf<
            (cb: (event: PushTokenEvent) => void) => () => void
        >();
        expectTypeOf(notifications.addTokenErrorListener).toEqualTypeOf<
            (cb: (event: PushTokenError) => void) => () => void
        >();
        expectTypeOf(notifications.addPushListener).toEqualTypeOf<
            (cb: (event: RemoteMessage) => void) => () => void
        >();
        expectTypeOf(notifications.addNotificationResponseListener).toEqualTypeOf<
            (cb: (event: NotificationResponse) => void) => () => void
        >();
    });

    it('keeps failures out of the schedule and badge results (C4)', () => {
        // Both reject on the native `{ error }` envelope, so neither return
        // type may grow a failure field again: `schedule` handing back an
        // `{ error }` object typed `string` is exactly the bug #895 found, and
        // a `Promise<void>` is only honest here because the error throws.
        expectTypeOf(Notifications.schedule).returns.toEqualTypeOf<Promise<string>>();
        expectTypeOf(Notifications.setBadgeCount).returns.toEqualTypeOf<Promise<void>>();
    });

    it('pins the nullable cold-start read and the error-carrying results', () => {
        // `null` means "the app wasn't launched by a tap"; collapsing it would
        // make every cold start look like a deep link. The push results keep
        // carrying failures as fields — a documented C3 opt-out, because the
        // same failure is published on `addTokenErrorListener`, the only
        // channel that can report it at all on iOS (web has no remote push
        // whatsoever). Losing `error?` would turn a documented no-op into an
        // unhandled rejection.
        expectTypeOf(Notifications.getInitialNotification).toEqualTypeOf<
            () => Promise<NotificationResponse | null>
        >();
        expectTypeOf<RegisterPushResult>().toEqualTypeOf<{
            token?: string;
            platform?: 'apns' | 'fcm';
            dispatched?: boolean;
            error?: string;
        }>();
        expectTypeOf<UnregisterPushResult>().toEqualTypeOf<{ ok: boolean; error?: string }>();
    });
});

describe('web implementation', () => {
    it('has the same surface as the native one', async () => {
        // The plugin swaps notifications.web.js in by extensionAlias (#697), so
        // a method added to one and not the other is a runtime failure on the
        // target that missed it — invisible to a normal typecheck.
        const web = await import('../src/notifications.web');
        expect(Object.keys(web.Notifications).sort()).toEqual(Object.keys(Notifications).sort());
    });
});
