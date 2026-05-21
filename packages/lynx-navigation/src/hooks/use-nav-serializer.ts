import { effect, onMounted, onUnmounted } from '@sigx/lynx';
import { useNav } from './use-nav.js';
import { useNavRoutes } from './use-nav-internal.js';
import type { StackEntry } from '../types.js';

/**
 * Plain JSON snapshot of a navigator. The whole point of holding navigation
 * state in signals is that this is a one-liner — `JSON.stringify(nav.stack)`.
 *
 * Shape is deliberately minimal:
 *
 *   {
 *     version: 1,
 *     stack: [ { key, route, params, search, state, presentation }, ... ],
 *   }
 *
 * `version` lets future schema migrations (or hard breakage) reject old
 * snapshots cleanly rather than restoring incompatible state.
 *
 * Per spec resolved-decisions: only the root navigator is persisted in v1.
 * Per-tab / nested-navigator stacks are deferred until the nested-navigators
 * follow-up slice lands.
 */
export interface NavSnapshot {
    version: number;
    stack: StackEntry[];
}

export const NAV_SNAPSHOT_VERSION = 1;

/**
 * Adapter contract for `useNavSerializer`. Implementations bridge to whatever
 * storage backend the host app uses — `@sigx/lynx-storage`, `localStorage`,
 * an MMKV bridge, etc. Both methods may be async; the hook awaits load before
 * applying anything to the stack and fires save in a debounced manner.
 *
 *   - `load()` returns `null` (or rejects) when no snapshot exists, when the
 *     stored payload is malformed, or when the host opts not to restore on
 *     this launch.
 *   - `save(snapshot)` persists the latest stack. The hook drops save errors
 *     on the floor — losing a write is preferable to crashing the navigator.
 */
export interface NavStorageAdapter {
    load(): Promise<NavSnapshot | null> | NavSnapshot | null;
    save(snapshot: NavSnapshot): Promise<void> | void;
}

export interface UseNavSerializerOptions {
    storage: NavStorageAdapter;
    /**
     * Trailing-edge debounce in ms before pushing a stack change to storage.
     * Defaults to 250ms — quick enough that a force-quit one tick after a
     * push is recoverable, slow enough that rapid `pop/push` flurries
     * coalesce into one write.
     */
    debounceMs?: number;
    /**
     * Optional callback after a successful restore — lets the host run
     * post-restore wiring (analytics, focus shifts, etc.) only when we
     * actually applied state, not on every mount.
     */
    onRestored?: (snapshot: NavSnapshot) => void;
    /**
     * Optional callback when a snapshot is rejected (validation failed or
     * load threw). Defaults to silent. Useful for logging during migration.
     */
    onRestoreError?: (reason: 'version' | 'shape' | 'unknown-route' | 'load-threw', err?: unknown) => void;
}

/**
 * Wire a navigator's stack to a storage adapter.
 *
 * On mount:
 *   1. Call `storage.load()`.
 *   2. Validate the snapshot (version match, every entry's route still
 *      registered).
 *   3. On success, `nav.reset({ stack })` to apply.
 *   4. On any failure, leave the stack alone (initial route remains).
 *
 * Then subscribe to `nav.stack` and call `storage.save(snapshot)` debounced.
 *
 * Why we don't validate `params` / `search` against schemas here: schemas
 * are part of the route definition, and re-running them across all entries
 * on every launch costs more than it's worth. The contract is "entries were
 * validated when they were pushed; if the schema has since changed in a
 * breaking way, bump `version` to reject old snapshots wholesale." Callers
 * who want a stricter check can run their own validation in
 * `storage.load()` and return `null` on mismatch.
 */
export function useNavSerializer(options: UseNavSerializerOptions): void {
    const nav = useNav();
    const routes = useNavRoutes();
    const debounceMs = options.debounceMs ?? 250;
    const onRestored = options.onRestored;
    const onErr = options.onRestoreError;

    // Mutable mount/state flags. Plain closure vars (no signals) — we don't
    // want any of this driving a render and we don't want it tracked by the
    // save-effect below.
    let mounted = true;
    let restoreDone = false;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    let stopEffect: (() => void) | null = null;

    onMounted(() => {
        // Kick off the load synchronously — adapters that return a value
        // immediately (sync stores, test doubles) hit the resolve branch on
        // the same tick. Promise adapters resolve on the microtask queue;
        // the `mounted` guard catches teardown races.
        Promise.resolve()
            .then(() => options.storage.load())
            .then((snap) => {
                if (!mounted) return;
                if (snap == null) {
                    restoreDone = true;
                    startSaveEffect();
                    return;
                }
                if (!isValidShape(snap)) {
                    onErr?.('shape');
                    restoreDone = true;
                    startSaveEffect();
                    return;
                }
                if (snap.version !== NAV_SNAPSHOT_VERSION) {
                    onErr?.('version');
                    restoreDone = true;
                    startSaveEffect();
                    return;
                }
                // Drop the snapshot if any entry references a route the app
                // no longer knows about — partial restoration is worse than
                // no restoration (could leave the user stranded on a screen
                // whose params won't validate when read by `useParams`).
                for (const entry of snap.stack) {
                    if (!routes[entry.route]) {
                        onErr?.('unknown-route');
                        restoreDone = true;
                        startSaveEffect();
                        return;
                    }
                }
                if (snap.stack.length === 0) {
                    onErr?.('shape');
                    restoreDone = true;
                    startSaveEffect();
                    return;
                }
                nav.reset({ stack: snap.stack });
                onRestored?.(snap);
                restoreDone = true;
                startSaveEffect();
            })
            .catch((err) => {
                if (!mounted) return;
                onErr?.('load-threw', err);
                restoreDone = true;
                startSaveEffect();
            });
    });

    function startSaveEffect() {
        if (!mounted || stopEffect) return;
        // The first effect run is just the initial subscription read — it
        // happens immediately when `effect()` is called, before any user
        // navigation, and represents the stack-as-restored (or the initial
        // route when there was nothing to restore). Either way, we don't
        // want to persist it: in the restore case it would race with the
        // adapter that just supplied this state, and in the fresh case
        // it's redundant.
        let firstRun = true;
        const runner = effect(() => {
            const stack = nav.stack;
            const snapshot: NavSnapshot = {
                version: NAV_SNAPSHOT_VERSION,
                stack: stack.map((e) => ({
                    key: e.key,
                    route: e.route,
                    params: e.params,
                    search: e.search,
                    state: e.state,
                    presentation: e.presentation,
                })),
            };
            if (firstRun) {
                firstRun = false;
                return;
            }
            schedule(snapshot);
        });
        stopEffect = () => runner.stop();
    }

    function schedule(snapshot: NavSnapshot) {
        if (pendingTimer != null) clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => {
            pendingTimer = null;
            try {
                const r = options.storage.save(snapshot);
                if (r && typeof (r as Promise<void>).catch === 'function') {
                    (r as Promise<void>).catch(() => {
                        // Save errors are intentionally swallowed — see the
                        // hook doc-comment. Hosts that need visibility can
                        // wrap their adapter.
                    });
                }
            } catch {
                // Same rationale.
            }
        }, debounceMs);
    }

    onUnmounted(() => {
        mounted = false;
        if (pendingTimer != null) {
            clearTimeout(pendingTimer);
            pendingTimer = null;
        }
        if (stopEffect) {
            stopEffect();
            stopEffect = null;
        }
    });
}

function isValidShape(s: unknown): s is NavSnapshot {
    if (!s || typeof s !== 'object') return false;
    const obj = s as { version?: unknown; stack?: unknown };
    if (typeof obj.version !== 'number') return false;
    if (!Array.isArray(obj.stack)) return false;
    for (const entry of obj.stack) {
        if (!entry || typeof entry !== 'object') return false;
        const e = entry as Record<string, unknown>;
        if (typeof e.key !== 'string') return false;
        if (typeof e.route !== 'string') return false;
        if (typeof e.presentation !== 'string') return false;
    }
    return true;
}
