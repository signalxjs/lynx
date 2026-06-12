/**
 * Controllable stand-in for `@sigx/lynx-updates`, wired in via
 * `vi.mock('@sigx/lynx-updates', …)` from the test file. Mirrors the real
 * package's reactive shape: a deeply reactive store + a `useUpdates()` that
 * returns a computed view over it, so components re-render when tests
 * mutate `mockStore`.
 */

import { computed, signal, type Computed } from '@sigx/lynx';
import { vi } from 'vitest';
import type { CurrentUpdateInfo, UpdateManifest, UpdatesState } from '@sigx/lynx-updates';

const RUNNING: CurrentUpdateInfo = {
    updateId: null,
    version: '1.0.0',
    embeddedVersion: '1.0.0',
    runtimeVersion: 'rt-1',
    isEmbedded: true,
    isFirstLaunchAfterUpdate: false,
    didRollBack: false,
    rolledBackUpdateId: null,
};

export function initialState(): UpdatesState {
    return {
        status: 'idle',
        manifest: null,
        progress: null,
        mandatory: false,
        error: null,
        currentlyRunning: { ...RUNNING },
    };
}

export function makeManifest(id: string, overrides: Partial<UpdateManifest> = {}): UpdateManifest {
    return {
        id,
        version: '1.2.3',
        runtimeVersion: 'rt-1',
        bundleUrl: `https://updates.example/${id}.lynx.bundle`,
        sha256: 'deadbeef'.repeat(8),
        mandatory: false,
        metadata: { releaseNotes: 'Bug fixes and improvements' },
        ...overrides,
    };
}

/** The reactive store tests mutate to drive component state. */
export const mockStore = signal<UpdatesState>(initialState());

export const UpdatesMock = {
    configure: vi.fn(),
    checkForUpdate: vi.fn().mockResolvedValue({ type: 'up-to-date' }),
    download: vi.fn().mockResolvedValue(undefined),
    apply: vi.fn().mockResolvedValue(undefined),
    markReady: vi.fn().mockResolvedValue(undefined),
    getCurrentlyRunning: vi.fn().mockResolvedValue({ ...RUNNING }),
    clearUpdates: vi.fn().mockResolvedValue(undefined),
    getState: (): UpdatesState => ({
        status: mockStore.status,
        manifest: mockStore.manifest ? { ...mockStore.manifest } : null,
        progress: mockStore.progress ? { ...mockStore.progress } : null,
        mandatory: mockStore.mandatory,
        error: mockStore.error,
        currentlyRunning: { ...mockStore.currentlyRunning },
    }),
    addListener: vi.fn(() => () => {}),
    isAvailable: () => false,
};

export function useUpdatesMock(): Computed<UpdatesState> {
    return computed(() => ({
        status: mockStore.status,
        manifest: mockStore.manifest,
        progress: mockStore.progress,
        mandatory: mockStore.mandatory,
        error: mockStore.error,
        currentlyRunning: mockStore.currentlyRunning,
    }));
}

export function resetUpdatesMock(): void {
    mockStore.$set(initialState());
    UpdatesMock.download.mockClear();
    UpdatesMock.apply.mockClear();
    UpdatesMock.checkForUpdate.mockClear();
}
