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
    return computed(() => ({
        status: store.status,
        manifest: store.manifest,
        progress: store.progress,
        mandatory: store.mandatory,
        error: store.error,
        currentlyRunning: store.currentlyRunning,
    }));
}
