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

`sigx prebuild` auto-discovers the package, links the native module, adds `POST_NOTIFICATIONS` (Android 13+), registers the FCM service, adds `UIBackgroundModes: remote-notification` to iOS, and wires the APNs callbacks. The Android 13+ runtime prompt comes from [`@sigx/lynx-permissions`](https://sigx.dev/lynx/modules/permissions/overview/), a dependency the auto-linker pulls in.

### Remote push setup

Prebuild now wires the rest of the remote-push plumbing too — you only supply the credentials:

- **Android.** The module declares the `com.google.gms.google-services` Gradle plugin, so prebuild applies it automatically (it processes `google-services.json` into the resources that initialize Firebase). Point `android.googleServicesFile` at your Firebase `google-services.json`; prebuild copies it into `android/app/` on every run so it survives `android/` regeneration:

  ```ts
  // signalx.config.ts
  export default {
      android: { googleServicesFile: './firebase/google-services.json' },
  };
  ```

  Keep the file at a gitignored path to stay out of source control.

- **iOS.** The module declares the `aps-environment` entitlement, so prebuild generates `<App>.entitlements` (Release → `production`) and `<App>.debug.entitlements` (Debug → `development`) and wires `CODE_SIGN_ENTITLEMENTS` per build configuration. You still need an Apple Developer account with the **Push Notifications** capability enabled and a signing identity / provisioning profile that includes it (e.g. via `ios.developmentTeam` + automatic signing, or fastlane match for distribution).

The token/message/tap flow on the server side is transport-agnostic — forward the device token to your backend (Azure Notification Hubs, Firebase Admin, etc.). See the docs for the full flow.

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

## License

MIT
