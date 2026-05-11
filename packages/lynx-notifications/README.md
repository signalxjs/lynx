# @sigx/lynx-notifications

Local push notifications for sigx-lynx. `UNUserNotificationCenter` on iOS, `NotificationManager` + `AlarmManager` on Android. **Local-only** — push notifications via APNs/FCM are not in this module.

## Install

```bash
pnpm add @sigx/lynx-notifications
```

```ts
// sigx.lynx.config.ts
export default defineLynxConfig({
    modules: ['@sigx/lynx-notifications'],
});
```

`sigx prebuild` auto-links the native module and adds `android.permission.POST_NOTIFICATIONS` (Android 13+). iOS notification permission is requested at runtime via `requestPermission()`.

> **Android pairs with `@sigx/lynx-permissions`** — needed for the runtime permission prompt on Android 13+.

## Usage

```ts
import { Notifications } from '@sigx/lynx-notifications';

const { status } = await Notifications.requestPermission();
if (status === 'granted') {
    const id = await Notifications.schedule(
        { title: 'Reminder', body: 'Check your tasks', data: { taskId: '42' } },
        { delay: 60 },     // seconds
    );
    // Cancel later by id:
    // await Notifications.cancel(id);
}

// Daily reminder
await Notifications.schedule(
    { title: 'Daily check-in', body: 'How are you feeling today?' },
    { delay: 60 * 60 * 24, repeat: 'day' },
);

await Notifications.cancelAll();
```

## API

| Method                                                                  | Notes                                                                                              |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `schedule(content: NotificationContent, options?: ScheduleOptions): Promise<string>` | Returns the notification id (use it for `cancel()`).                                  |
| `cancel(notificationId: string): Promise<void>`                         | Cancels a scheduled notification. No-op if not scheduled.                                          |
| `cancelAll(): Promise<void>`                                            | Cancels all pending notifications scheduled by this app.                                           |
| `requestPermission(): Promise<PermissionResponse>`                      | Shows the OS permission dialog if needed.                                                          |
| `getPermissionStatus(): Promise<PermissionResponse>`                    | Read-only check — no prompt.                                                                       |
| `isAvailable(): boolean`                                                | Whether the native module is registered in the current build.                                      |

```ts
interface NotificationContent {
    title: string;
    body: string;
    data?: Record<string, string>;
}

interface ScheduleOptions {
    delay?: number;                                   // seconds from now; default = immediate
    repeat?: 'minute' | 'hour' | 'day' | 'week';      // periodic re-fire
}
```

## Gotchas

- **Foreground delivery on iOS.** When the app is in the foreground, iOS suppresses the banner by default. Hook into `UNUserNotificationCenterDelegate` natively if you need in-app banners.
- **Tap callbacks aren't surfaced in JS yet.** The notification fires, but if the user taps it the routing/payload-handling has to happen on the native side (or via deep links). A future revision could expose an `onResponse` event.

## Reference app

`examples/lynx-one/my-sigx-app/src/cards/NotificationsCard.tsx` covers permission + schedule-with-delay + cancel.
