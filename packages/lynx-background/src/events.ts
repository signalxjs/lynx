/**
 * Native → JS event channel for background task fires. The native side
 * (BGTaskScheduler on iOS, WorkManager on Android) publishes a
 * BackgroundFireEvent when the OS wakes a task; JS subscribes via this shim
 * and routes to the registered handler in `background.ts`.
 *
 * Wire shape:
 *   { taskName: string, runId: string }
 *
 * `runId` is a native-generated UUID per fire. JS uses it when calling
 * `Background.completeTask(runId, success)` so the native side can pair the
 * completion with the right OS task instance (a periodic task can fire
 * concurrently with itself if the previous run is still pending).
 */

const FIRE_CHANNEL = '__sigxBackgroundFire';

export interface BackgroundFireEvent {
    taskName: string;
    runId: string;
}

interface GlobalEventEmitterLike {
    addListener: (name: string, fn: (...a: unknown[]) => void) => void;
    removeListener: (name: string, fn: (...a: unknown[]) => void) => void;
}

interface LynxLike {
    getJSModule?: (name: string) => GlobalEventEmitterLike | undefined;
}

declare const lynx: unknown | undefined;

function emitter(): GlobalEventEmitterLike | undefined {
    if (typeof lynx === 'undefined') return undefined;
    const obj = lynx as unknown as LynxLike;
    return obj.getJSModule?.('GlobalEventEmitter');
}

function safeParse(s: string): unknown {
    try { return JSON.parse(s); } catch { return undefined; }
}

export function addBackgroundFireListener(
    cb: (event: BackgroundFireEvent) => void,
): () => void {
    const e = emitter();
    if (!e) {
        // Web / SSR / test fallback: no native bridge, return a no-op
        // unsubscribe. Real delivery is exercised on-device.
        return () => {};
    }
    const wrapped = (raw: unknown) => {
        const event = (typeof raw === 'string' ? safeParse(raw) : raw) as
            | BackgroundFireEvent
            | undefined;
        if (
            event === undefined ||
            typeof event.taskName !== 'string' ||
            typeof event.runId !== 'string'
        ) {
            return;
        }
        try {
            cb(event);
        } catch (err) {
            console.warn(`[background] listener for ${FIRE_CHANNEL} threw:`, err);
        }
    };
    e.addListener(FIRE_CHANNEL, wrapped);
    return () => e.removeListener(FIRE_CHANNEL, wrapped);
}

export const __FIRE_CHANNEL_FOR_TESTS = FIRE_CHANNEL;
