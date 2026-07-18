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

## Message shapes

All three shapes are accepted, but what each one can actually *do* differs sharply by
platform — read the row before you pick. Most of that asymmetry is an APNs/FCM constraint
rather than module policy; the one exception is iOS data-only delivery to JS, which is a
gap on our side ([#621](https://github.com/signalxjs/lynx/issues/621)), not Apple's.

| Shape | iOS / APNs | Android / FCM |
|---|---|---|
| **`notification` + `data`** | Tray entry rendered by the OS. Foreground → `addPushListener`. Tap → response listener; cold-start tap → `getInitialNotification()`. | Same. The OS renders the tray entry while backgrounded and the module recovers the tap payload from the launch intent. |
| **`notification` only** | As above, with `data` empty. | As above, with `data` empty. |
| **`data` only**<br>(iOS also needs `"content-available": 1`, `apns-push-type: background`, `apns-priority: 5`) | **No tray entry — APNs cannot display one without an `alert`**, so there is no tap and no cold-start payload. Not delivered to JS either yet — see the iOS data-only note below. | Tray entry rendered by the module, reading `title`/`body` out of `data`. Delivered to `addPushListener`; tap → response listener / `getInitialNotification()`. |

Notes worth knowing before you pick:

- **`notification` + `data` is the only shape whose tray entry, tap routing and
  cold-start payload work on both platforms.** Add `"content-available": 1` if you
  also want an iOS background wake.
- **Android, data-only:** the one shape FCM delivers to the app while backgrounded
  or terminated — a message carrying `notification` is rendered by the OS and never
  reaches `onMessageReceived`. Set `data.title` (and optionally `data.body`) or no
  tray entry is posted. Set `data.notification_id` for a stable notification id.
- **Android, `notification` + `data`:** tap payload is recovered from the launch
  intent on a **best-effort** basis. Cold start is reliable; a warm tap goes through
  an intent FCM builds and may not be delivered at all. Data-only is the dependable
  path if tap routing matters.
- **iOS, data-only:** a silent `content-available` push — throttled (a few per hour)
  and **not delivered at all once the user force-quits the app**. Reaching JS at all
  needs `didReceiveRemoteNotification`, which isn't wired yet — see
  [#621](https://github.com/signalxjs/lynx/issues/621).

Custom `data` values are strings on both platforms (FCM's `data` map is string-only).
iOS JSON-encodes non-string APNs values, so a nested custom object round-trips via
`JSON.parse(msg.data.yourKey)`.

## Dismissing notifications

`Notifications.cancel(id)` cancels a pending scheduled notification **and** dismisses delivered tray entries — including remote pushes sent with `data.notification_id === id` (both platforms). Give related pushes a stable `notification_id` (e.g. one per conversation) and you can clear them from JS when they're no longer relevant — say, when the user reads the conversation on another device:

```ts
await Notifications.cancel('chat-4711');   // dismisses the tray entry for data.notification_id 'chat-4711'
```

The same `notification_id` also keys tap responses (`addNotificationResponseListener`). Optionally, senders can set the APNs `apns-collapse-id` header to the same id — that makes iOS replace the tray entry in place on each push, matching Android's behavior.

## Conversation stacking (Android)

By default, Android pushes sharing a `notification_id` replace each other in place — only the newest body is visible. For conversation-shaped notifications (a chat thread, an activity feed on one subject), opt into **stacking** with `data.style: "messaging"`: each push under the same `notification_id` *appends* a line to the tray entry (rendered with Android's `MessagingStyle`), keeping the last 7 messages visible.

| `data` key | Effect |
|---|---|
| `style: "messaging"` | Opt in to stacking. Anything else (or absent) keeps replace-in-place. |
| `sender_name` (or `senderName`) | Name shown on the appended line. Falls back to `title`. |
| `conversation_title` (or `conversationTitle`) | Header above the message lines (e.g. a group-chat name). Carried over from earlier pushes when omitted. |
| `group` | Bundles entries that share the value under one expandable tray group, with an auto-posted summary row — the pattern for "several conversations active at once". `Notifications.cancel(group)` dismisses the summary. Use a value distinct from every `notification_id` (the two share an id space). |

```jsonc
// per-message push (FCM data map)
{
  "title": "Ada",                     // collapsed view + sender fallback
  "body": "See you at 10?",
  "style": "messaging",
  "notification_id": "chat-4711",     // one per conversation → messages stack
  "sender_name": "Ada",
  "conversation_title": "Standup crew",
  "group": "chats"                    // optional: bundle all conversations
}
```

Tap routing is unchanged: the tap payload is the **latest** push's `data`, and `Notifications.cancel('chat-4711')` clears the whole stacked entry. History lives in the tray itself, so it survives process death and needs no storage; devices below Android 6.0 fall back to replace-in-place.

iOS needs none of this — set the APNs `aps.thread-id` to the conversation id and the OS stacks the group natively.

## Web

**Local** notifications work on web through the `@sigx/lynx-web-host` page bridge (the browser Notification API): `schedule`/`cancel`/`cancelAll` and the permission methods behave as on native (browser denial reports `blocked` — the user must change the site setting). Page-lifetime best-effort: scheduled timers and repeats don't survive a reload. Badges use the Badging API where available (installed PWAs, Chromium); `getBadgeCount()` returns a locally-tracked value.

**Remote push is not supported on web** — `registerForPushNotifications()` resolves `{ error }` (no throw), no token/push/tap events fire, and `getInitialNotification()` resolves `null`. Web Push proper (service-worker push) is tracked separately.

## License

MIT
