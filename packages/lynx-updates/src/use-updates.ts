import { computed, type Computed } from '@sigx/lynx';
import { store } from './state.js';
import type { UpdatesState } from './types.js';

/**
 * BG-reactive updates state for components (the `useKeyboard()` idiom).
 * Re-evaluates whenever the controller transitions the state machine —
 * status, manifest, download progress, mandatory flag, errors.
 *
 * ```tsx
 * const updates = useUpdates();
 * return () => updates.value.status === 'downloading'
 *   ? <Progress value={percent(updates.value.progress)} />
 *   : null;
 * ```
 */
export function useUpdates(): Computed<UpdatesState> {
    // Shallow-cloned snapshots (matching Updates.getState()) — the controller
    // is the only writer, and handing out live proxy references would let a
    // consumer mutate the state machine by accident. The spreads also read
    // every field, so the computed re-evaluates on any nested change.
    return computed(() => ({
        status: store.status,
        manifest: store.manifest ? { ...store.manifest } : null,
        progress: store.progress ? { ...store.progress } : null,
        mandatory: store.mandatory,
        error: store.error,
        currentlyRunning: { ...store.currentlyRunning },
    }));
}
