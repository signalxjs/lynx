# @sigx/lynx-notifications

Local **and remote** push notifications for sigx-lynx.

- iOS: `UNUserNotificationCenter` for scheduling and the foreground/tap delegate, APNs for remote push.
- Android: `NotificationManager` + `AlarmManager` for scheduling, Firebase Cloud Messaging for remote push.

Transport-agnostic on the server side: pair it with any APNs/FCM-fronting service — Azure Notification Hubs, Firebase Admin, OneSignal, Braze, AWS SNS, or direct APNs/FCM — by forwarding the device token to your backend.

## 📚 Documentation

Full API, remote-push setup (APNs entitlement, Firebase), event channels and live examples → **[sigx.dev/lynx/modules/notifications/overview](https://sigx.dev/lynx/modules/notifications/overview/)**

## Install

```bash
pnpm add @sigx/lynx-notifications
```

`sigx prebuild` auto-discovers the package, links the native module, adds `POST_NOTIFICATIONS` (Android 13+), registers the FCM service, adds `UIBackgroundModes: remote-notification` to iOS, and wires the APNs callbacks. The Android 13+ runtime prompt comes from [`@sigx/lynx-permissions`](https://sigx.dev/lynx/modules/permissions/overview/), a dependency the auto-linker pulls in. Remote push also needs a one-time per-app APNs entitlement (iOS) and a Firebase project + `google-services.json` (Android) — see the docs.

## A taste

```ts
import { Notifications } from '@sigx/lynx-notifications';

const { status } = await Notifications.requestPermission();
if (status === 'granted') {
    await Notifications.schedule(
        { title: 'Reminder', body: 'Check your tasks', data: { taskId: '42' } },
        { delay: 60 },     // seconds
    );
}
```

The full remote-push flow (`registerForPushNotifications`, token/message/tap listeners, cold-start handling, badge management), the complete API, the raw event channels and platform gotchas are documented on the docs site.

## Dismissing notifications

`Notifications.cancel(id)` cancels a pending scheduled notification **and** dismisses delivered tray entries — including remote pushes sent with `data.notification_id === id` (both platforms). Give related pushes a stable `notification_id` (e.g. one per conversation) and you can clear them from JS when they're no longer relevant — say, when the user reads the conversation on another device:

```ts
await Notifications.cancel('chat-4711');   // dismisses the tray entry for data.notification_id 'chat-4711'
```

The same `notification_id` also keys tap responses (`addNotificationResponseListener`). Optionally, senders can set the APNs `apns-collapse-id` header to the same id — that makes iOS replace the tray entry in place on each push, matching Android's behavior.

## License

MIT
