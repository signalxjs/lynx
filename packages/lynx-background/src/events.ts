/**
 * Native → JS event channel for background task fires. The native side
 * (BGTaskScheduler on iOS, WorkManager on Android) publishes a
 * BackgroundFireEvent when the OS wakes a task; JS subscribes via
 * `subscribeNative` (C7) and routes to the registered handler in
 * `background.ts`.
 *
 * Wire shape:
 *   { taskName: string, runId: string }
 *
 * `runId` is a native-generated UUID per fire. JS uses it when calling
 * `Background.completeTask(runId, success)` so the native side can pair the
 * completion with the right OS task instance (a periodic task can fire
 * concurrently with itself if the previous run is still pending).
 */
import { subscribeNative } from '@sigx/lynx-core';

const FIRE_CHANNEL = '__sigxBackgroundFire';

export interface BackgroundFireEvent {
    taskName: string;
    runId: string;
}

/**
 * Both fields are load-bearing: `taskName` picks the handler and `runId` is
 * the token `completeTask` needs. A payload missing either can't be acted on,
 * so it is dropped rather than dispatched — completing with a bogus `runId`
 * would resolve the wrong OS task instance.
 */
function isBackgroundFireEvent(raw: unknown): raw is BackgroundFireEvent {
    if (typeof raw !== 'object' || raw === null) return false;
    const e = raw as Partial<BackgroundFireEvent>;
    return typeof e.taskName === 'string' && typeof e.runId === 'string';
}

/**
 * Subscribe to native background-task fires.
 *
 * @returns unsubscribe; calling it more than once is a no-op (C7).
 */
export function addBackgroundFireListener(
    cb: (event: BackgroundFireEvent) => void,
): () => void {
    return subscribeNative<BackgroundFireEvent>(FIRE_CHANNEL, cb, {
        validate: isBackgroundFireEvent,
        namespace: 'lynx-background',
    });
}

export const __FIRE_CHANNEL_FOR_TESTS = FIRE_CHANNEL;
