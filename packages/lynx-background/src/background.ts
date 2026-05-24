import { callAsync, isModuleAvailable } from '@sigx/lynx-core';
import { addBackgroundFireListener, type BackgroundFireEvent } from './events.js';

const MODULE = 'Background';

export type BackgroundTaskType = 'fetch' | 'processing';

export interface RegisterOptions {
    /**
     * Seconds. On iOS this is `BGTaskRequest.earliestBeginDate` — the OS
     * treats it as "no earlier than", and may fire much later (or never).
     * On Android it's the `PeriodicWorkRequest` repeat interval, clamped to
     * a 15-minute (900s) floor by the platform.
     */
    minimumInterval?: number;
    requiresNetwork?: boolean;
    requiresCharging?: boolean;
    /**
     * iOS only. `'fetch'` → `BGAppRefreshTask` (lightweight, ~30s budget).
     * `'processing'` → `BGProcessingTask` (longer budget, can require
     * charging). Defaults to `'fetch'`. Ignored on Android, where the
     * `requiresCharging` constraint covers the same use case.
     */
    type?: BackgroundTaskType;
}

export type BackgroundHandler = () => unknown | Promise<unknown>;

const handlers = new Map<string, BackgroundHandler>();

let dispatcherSubscription: (() => void) | undefined;

function ensureDispatcher(): void {
    if (dispatcherSubscription) return;
    dispatcherSubscription = addBackgroundFireListener((event) => {
        void dispatch(event);
    });
}

async function dispatch(event: BackgroundFireEvent): Promise<void> {
    const handler = handlers.get(event.taskName);
    if (!handler) {
        // No JS handler registered for this taskName — complete as
        // success=false so the OS doesn't think the work succeeded silently.
        // Common case during cold-start race: native fires before JS finishes
        // running `setHandler`. Apps must wire handlers as early as possible
        // (see README) — the bounded grace period is implemented native-side.
        await safeComplete(event.runId, false);
        return;
    }
    let success = false;
    try {
        await handler();
        success = true;
    } catch (err) {
        console.warn(`[background] handler for "${event.taskName}" threw:`, err);
        success = false;
    } finally {
        await safeComplete(event.runId, success);
    }
}

async function safeComplete(runId: string, success: boolean): Promise<void> {
    try {
        await callAsync<void>(MODULE, 'completeTask', runId, success);
    } catch (err) {
        // Best-effort — the native side may already have timed out and
        // completed the task. Logging is enough.
        console.warn(`[background] completeTask(${runId}) failed:`, err);
    }
}

/**
 * Periodic background tasks via iOS `BGTaskScheduler` and Android
 * `WorkManager`.
 *
 * @example
 * ```ts
 * import { Background } from '@sigx/lynx-background';
 *
 * Background.setHandler('refresh-feed', async () => {
 *     const res = await fetch('https://example.com/feed.json');
 *     await Storage.set('feed', await res.text());
 * });
 *
 * await Background.register('refresh-feed', {
 *     minimumInterval: 15 * 60,
 *     requiresNetwork: true,
 * });
 * ```
 */
export const Background = {
    /**
     * Schedule a background task. Idempotent — calling twice with the same
     * `taskName` updates the existing request rather than creating a
     * duplicate. Safe to call on every cold start.
     */
    register(taskName: string, options: RegisterOptions = {}): Promise<void> {
        ensureDispatcher();
        return callAsync<void>(MODULE, 'register', taskName, options);
    },

    /** Cancel a previously-registered task. No-op if not registered. */
    unregister(taskName: string): Promise<void> {
        return callAsync<void>(MODULE, 'unregister', taskName);
    },

    /**
     * Register the JS handler for a task. Must be called BEFORE the first
     * `register` on every cold start — the OS can fire the task as soon as
     * the process starts, before any UI is up. Returns an unsubscribe
     * function that clears the handler (subsequent fires will complete as
     * no-ops until a new handler is set).
     */
    setHandler(taskName: string, handler: BackgroundHandler): () => void {
        ensureDispatcher();
        handlers.set(taskName, handler);
        return () => {
            // Only clear if it's still THIS handler — prevents an unsubscribe
            // from clobbering a later setHandler call for the same task.
            if (handlers.get(taskName) === handler) {
                handlers.delete(taskName);
            }
        };
    },

    /**
     * List task identifiers currently persisted by the native side. Useful
     * for diagnostics ("did the previous app version register tasks I no
     * longer know about?") and for cleaning up stale registrations:
     *
     * ```ts
     * const known = new Set(['refresh-feed', 'sync-outbox']);
     * for (const name of await Background.getRegistered()) {
     *     if (!known.has(name)) await Background.unregister(name);
     * }
     * ```
     */
    getRegistered(): Promise<string[]> {
        return callAsync<string[]>(MODULE, 'getRegistered');
    },

    /** Whether the native module is wired in the current build. */
    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;

// Exposed for tests so the module-level handler map can be reset between
// cases. Not part of the public API.
export const __resetForTests = (): void => {
    handlers.clear();
    dispatcherSubscription?.();
    dispatcherSubscription = undefined;
};
