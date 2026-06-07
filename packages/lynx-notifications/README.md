# @sigx/lynx-notifications

Local **and remote** push notifications for sigx-lynx.

- iOS: `UNUserNotificationCenter` for scheduling and the foreground/tap delegate, APNs for remote push.
- Android: `NotificationManager` + `AlarmManager` for scheduling, Firebase Cloud Messaging for remote push.

Transport-agnostic on the server side: you pair this with any APNs/FCM-fronting service — Azure Notification Hubs, Firebase Admin, OneSignal, Braze, AWS SNS, or direct APNs/FCM — by forwarding the device token to your backend.

## Install

```bash
pnpm add @sigx/lynx-notifications
```

`sigx prebuild` auto-discovers the package, links the native module, adds `android.permission.POST_NOTIFICATIONS` (Android 13+), registers the FCM service in `AndroidManifest.xml`, adds `UIBackgroundModes: remote-notification` to iOS `Info.plist`, and wires the APNs callbacks through the generated `AppDelegate` dispatcher.

On Android 13+ the runtime permission prompt comes from [`@sigx/lynx-permissions`](../lynx-permissions), a dependency of this package — the auto-linker pulls it in, nothing to install.

### One-time manual setup for remote push

Two things are **not** handled by `sigx prebuild` and must be configured per-app:

**iOS — APNs entitlement.** Push won't work without the `aps-environment` entitlement plus a paid Apple Developer account with the Push Notifications capability enabled for your bundle id.

1. In Xcode → Signing & Capabilities → `+ Capability` → Push Notifications.
2. That creates `<AppName>/<AppName>.entitlements` containing `aps-environment = development`. Xcode also sets `CODE_SIGN_ENTITLEMENTS` automatically.

**Android — Firebase project + `google-services.json`.**

1. Create a Firebase project at console.firebase.google.com, add an Android app with your `applicationId`.
2. Download `google-services.json` and place it at `android/app/google-services.json`.
3. Add the Google Services Gradle plugin (modern plugins DSL — the sigx-lynx Android template doesn't use the legacy `buildscript { classpath … }` block):
    - In `android/build.gradle.kts` (root), add to the top-level `plugins { … }`:
        ```kotlin
        id("com.google.gms.google-services") version "4.4.2" apply false
        ```
    - In `android/app/build.gradle.kts`, add to its `plugins { … }`:
        ```kotlin
        id("com.google.gms.google-services")
        ```

## Usage

### Local notifications (unchanged)

```ts
import { Notifications } from '@sigx/lynx-notifications';

const { status } = await Notifications.requestPermission();
if (status === 'granted') {
    const id = await Notifications.schedule(
        { title: 'Reminder', body: 'Check your tasks', data: { taskId: '42' } },
        { delay: 60 },     // seconds
    );
}
```

### Remote push (Azure Notification Hubs, FCM, etc.)

```ts
import { Notifications } from '@sigx/lynx-notifications';

// 1. Get permission.
const { status } = await Notifications.requestPermission();
if (status !== 'granted') return;

// 2. Subscribe to events BEFORE registering — on iOS the token arrives
//    asynchronously through the AppDelegate hook, so a late subscriber
//    would miss it. (The native side caches the last token and replays
//    it on subscribe, but subscribing first is the cleaner pattern.)
const unsubToken = Notifications.addTokenListener(async ({ token, platform }) => {
    // Forward to your backend; backend registers with Azure Notification Hubs:
    //   await fetch('/api/register-device', { method: 'POST', body: JSON.stringify({ token, platform }) });
});

const unsubMsg = Notifications.addPushListener((msg) => {
    console.log('foreground push', msg);
});

const unsubTap = Notifications.addNotificationResponseListener(({ notificationId, data }) => {
    // User tapped a notification — route them somewhere.
    // Works for remote AND local notifications.
});

// 3. Trigger registration.
const result = await Notifications.registerForPushNotifications();
//  iOS: { dispatched: true }   — token arrives via addTokenListener
//  Android: { token, platform: 'fcm' } directly

// 4. Cold-start handler: if the app was launched by a notification tap.
const initial = await Notifications.getInitialNotification();
if (initial) {
    // route based on initial.data
}

// 5. Badge management (iOS only meaningfully — Android passes count=0 to clear).
await Notifications.setBadgeCount(0);
```

## API

| Method                                                              | Notes                                                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `schedule(content, options?): Promise<string>`                      | Local. Returns the notification id (use it for `cancel`).                                                          |
| `cancel(notificationId): Promise<void>`                             | Cancels a scheduled notification. No-op if not scheduled.                                                          |
| `cancelAll(): Promise<void>`                                        | Cancels all pending notifications scheduled by this app.                                                           |
| `requestPermission(): Promise<PermissionResponse>`                  | Shows the OS permission dialog if needed.                                                                          |
| `getPermissionStatus(): Promise<PermissionResponse>`                | Read-only check — no prompt.                                                                                       |
| `registerForPushNotifications(): Promise<RegisterPushResult>`       | iOS dispatches APNs registration (token via `addTokenListener`). Android resolves with FCM token directly.         |
| `unregisterForPushNotifications(): Promise<void>`                   | Stops receiving remote pushes.                                                                                     |
| `setBadgeCount(n): Promise<void>`                                   | iOS: app icon badge. Android: no-op (stock Android has no portable badging API; call `cancelAll()` to clear).      |
| `getBadgeCount(): Promise<number>`                                  | iOS: current badge. Android: always 0.                                                                             |
| `getInitialNotification(): Promise<NotificationResponse \| null>`   | Payload that launched the app from a cold start. One-shot — call exactly once on startup.                          |
| `addTokenListener(cb): () => void`                                  | Subscribe to `{ token, platform }`. Returns unsubscribe.                                                           |
| `addTokenErrorListener(cb): () => void`                             | Subscribe to APNs / FCM registration failures.                                                                     |
| `addPushListener(cb): () => void`                                   | Subscribe to incoming remote messages. Fires on foreground + when FCM data messages arrive while backgrounded.     |
| `addNotificationResponseListener(cb): () => void`                   | Subscribe to user taps — fires for **remote AND local** notifications.                                             |
| `isAvailable(): boolean`                                            | Whether the native module is registered in the current build.                                                      |

```ts
interface NotificationContent { title: string; body: string; data?: Record<string, string>; }
interface ScheduleOptions     { delay?: number; repeat?: 'minute' | 'hour' | 'day' | 'week'; }
interface RegisterPushResult  { token?: string; platform?: 'apns' | 'fcm'; dispatched?: boolean; error?: string; }
interface RemoteMessage       { title?: string; body?: string; data: Record<string, string>; foreground: boolean; }
interface NotificationResponse{ notificationId: string; data: Record<string, string>; actionIdentifier: string; }
```

## Event channels (advanced)

Native publishes on three `GlobalEventEmitter` channels: `__sigxPushToken`, `__sigxPushMessage`, `__sigxNotificationResponse` (plus `__sigxPushTokenError`). The listener helpers above are thin wrappers — apps that already manage their own event bus can subscribe to those channels directly.

## Gotchas

- **iOS simulator can't receive APNs pushes** — registration will fail with `remote notifications are not supported in the simulator`. Use a real device for end-to-end push testing. Local notifications and the tap-callback path work fine in the simulator.
- **FCM token before Firebase init** — if `google-services.json` is missing or invalid, `registerForPushNotifications` resolves with `{ error: 'FCM unavailable: ...' }` instead of crashing the bridge. Check the result.
- **Foreground delivery on iOS** — now shown with banner + sound by default. To suppress, override `UNUserNotificationCenter.current().delegate` in your own AppDelegate hook.
- **Android notification taps** — fire `addNotificationResponseListener` only when the notification was popped via `SigxFirebaseMessagingService` (the launch intent carries our extras). Local notifications scheduled via `Notifications.schedule` do not yet route taps on Android — track via the GitHub issue.

