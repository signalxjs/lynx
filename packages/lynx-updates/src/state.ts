/**
 * Global reactive store + event fan-out for the updates state machine.
 * The controller is the only writer; UI reads via `useUpdates()` or
 * `Updates.getState()`, imperative code subscribes via `Updates.addListener`.
 */

import { signal } from '@sigx/lynx';
import type { CurrentUpdateInfo, UpdatesEvent, UpdatesState } from './types.js';

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
const listeners = new Set<Listener>();

export function addListener(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Emit an event to subscribers (never throws). @internal */
export function emit(event: UpdatesEvent): void {
    for (const fn of [...listeners]) {
        try {
            fn(event);
        } catch (err) {
            console.warn('[updates] event listener threw:', err);
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
