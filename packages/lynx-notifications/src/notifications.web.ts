/**
 * Web implementation: **local** notifications route through the
 * `@sigx/lynx-web-host` page bridge (`sigx.notifications.*` → the browser
 * Notification API; the app worker can show worker-less notifications only in
 * some browsers, so the page owns them). Page-lifetime best-effort: scheduled
 * timers and repeats don't survive a reload.
 *
 * **Remote push is not supported on web** — `registerForPushNotifications`
 * resolves with `{ error }` (the result shape carries errors, so callers
 * degrade without try/catch) and no token/push/response events ever fire; the
 * GlobalEventEmitter-backed listener re-exports from `./push.js` are reused
 * unchanged and are safe no-ops. Web Push proper (service-worker push) is a
 * separate project (#718).
 *
 * Badge: Badging API best-effort on the host (installed PWAs, Chromium);
 * `getBadgeCount()` returns the locally-tracked value (no portable read API —
 * same spirit as Android's always-0).
 * Swapped in by the plugin's `.web.js` extensionAlias (#697).
 */
import { webHostCall, isWebHostAvailable } from '@sigx/lynx-core';
import type { PermissionResponse } from '@sigx/lynx-core';

import {
  addTokenListener,
  addTokenErrorListener,
  addPushListener,
  addNotificationResponseListener,
  type NotificationResponse,
  type PushTokenEvent,
  type PushTokenError,
  type RemoteMessage,
} from './push.js';
import type {
  NotificationContent,
  ScheduleOptions,
  RegisterPushResult,
  UnregisterPushResult,
} from './notifications.js';

export type {
  NotificationContent,
  ScheduleOptions,
  RegisterPushResult,
  UnregisterPushResult,
} from './notifications.js';

const PUSH_UNSUPPORTED = 'remote push is not supported on web (see signalxjs/lynx#718)';

export const Notifications: typeof import('./notifications.js').Notifications = {
  schedule(content: NotificationContent, options: ScheduleOptions = {}): Promise<string> {
    return webHostCall<string>('notifications.schedule', {
      title: content.title,
      body: content.body,
      data: content.data,
      delay: options.delay,
      repeat: options.repeat,
    });
  },

  cancel(notificationId: string): Promise<boolean> {
    return webHostCall<boolean>('notifications.cancel', { id: notificationId });
  },

  cancelAll(): Promise<boolean> {
    return webHostCall<boolean>('notifications.cancelAll');
  },

  requestPermission(): Promise<PermissionResponse> {
    return webHostCall<PermissionResponse>('notifications.requestPermission');
  },

  getPermissionStatus(): Promise<PermissionResponse> {
    return webHostCall<PermissionResponse>('notifications.permissionStatus');
  },

  registerForPushNotifications(): Promise<RegisterPushResult> {
    return Promise.resolve({ error: PUSH_UNSUPPORTED });
  },

  unregisterForPushNotifications(): Promise<UnregisterPushResult> {
    return Promise.resolve({ ok: false, error: PUSH_UNSUPPORTED });
  },

  setBadgeCount(count: number): Promise<void> {
    return webHostCall<void>('notifications.setBadge', { count });
  },

  getBadgeCount(): Promise<number> {
    return webHostCall<number>('notifications.getBadge');
  },

  getInitialNotification(): Promise<NotificationResponse | null> {
    return Promise.resolve(null); // web apps aren't launched by notification taps
  },

  addTokenListener,
  addTokenErrorListener,
  addPushListener,
  addNotificationResponseListener,

  isAvailable(): boolean {
    return isWebHostAvailable();
  },
} as const;

export type { NotificationResponse, PushTokenEvent, PushTokenError, RemoteMessage };
