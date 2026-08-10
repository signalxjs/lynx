/**
 * Global reactive store + event fan-out for the updates state machine.
 * The controller is the only writer; UI reads via `useUpdates()` or
 * `Updates.getState()`, imperative code subscribes via `Updates.addListener`.
 */

import { signal } from '@sigx/lynx';
import { createLogger } from '@sigx/lynx-core';
import type { CurrentUpdateInfo, UpdatesEvent, UpdatesState } from './types.js';

const log = createLogger('updates');

const INITIAL_RUNNING: CurrentUpdateInfo = {
    updateId: null,
    version: '',
    embeddedVersion: '',
    runtimeVersion: 'unknown',
    isEmbedded: true,
    isFirstLaunchAfterUpdate: false,
    didRollBack: false,
    rolledBackUpdateId: null,
};

function initialState(): UpdatesState {
    return {
        status: 'idle',
        manifest: null,
        progress: null,
        mandatory: false,
        error: null,
        currentlyRunning: { ...INITIAL_RUNNING },
    };
}

/** The store — a deeply reactive proxy (object signal). @internal */
export const store = signal<UpdatesState>(initialState());

type Listener = (event: UpdatesEvent) => void;

/**
 * Registrations are boxed so subscription identity is per *call*, not per
 * function. Keyed on the callback itself (a `Set<Listener>`), two subscribers
 * sharing one handler — a module-level `logUpdate` used by two components, say
 * — collapse into a single entry, and the first cleanup then silently
 * unsubscribes the second. The same shape also let a stale disposer remove a
 * later re-subscription of the same function.
 *
 * Boxing makes each disposer target exactly its own registration, which is
 * what C7's "calling it twice is a no-op" actually requires.
 */
interface Registration {
    fn: Listener;
}
const listeners = new Set<Registration>();

export function addListener(fn: Listener): () => void {
    const entry: Registration = { fn };
    listeners.add(entry);
    return () => {
        listeners.delete(entry);
    };
}

/** Emit an event to subscribers (never throws). @internal */
export function emit(event: UpdatesEvent): void {
    for (const entry of [...listeners]) {
        try {
            entry.fn(event);
        } catch (err) {
            log.warn('event listener threw:', err);
        }
    }
}

/**
 * Fully detached manifest copy — `metadata` is the only nested field, so
 * cloning it makes the snapshot deep. @internal
 */
export function cloneManifest(manifest: UpdatesState['manifest']): UpdatesState['manifest'] {
    if (!manifest) return null;
    return {
        ...manifest,
        ...(manifest.metadata ? { metadata: { ...manifest.metadata } } : {}),
    };
}

/** Snapshot of the current state (plain object, detached from the proxy). */
export function getStateSnapshot(): UpdatesState {
    return {
        status: store.status,
        manifest: cloneManifest(store.manifest),
        progress: store.progress ? { ...store.progress } : null,
        mandatory: store.mandatory,
        error: store.error,
        currentlyRunning: { ...store.currentlyRunning },
    };
}

/** Test-only: reset the store and drop all listeners. @internal */
export function __resetForTests(): void {
    store.$set(initialState());
    listeners.clear();
}
