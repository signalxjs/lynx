/**
 * `useOrientationLock()` — mount-scoped orientation locks.
 *
 * The behavior worth pinning is the STACKING. `@sigx/lynx-navigation` keeps a
 * covered screen mounted under a card, modal or sheet, so two holders are
 * routinely alive at once; an unconditional unlock on unmount would drop a
 * still-mounted screen's lock as soon as anything presented above it went
 * away.
 *
 * The lifecycle hooks are mocked rather than driven through a real renderer:
 * `@sigx/lynx-testing` depends on `@sigx/lynx`, so devDepending on it here
 * would make the topological build cycle. Capturing the registered callbacks
 * lets the test fire mount/unmount in any order — which is the point, since
 * screens do not unwind LIFO. What this does NOT cover is the two-line
 * `onMounted`/`onUnmounted` wiring itself.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

const lock = vi.fn<(to: string) => Promise<void>>(() => Promise.resolve());
const unlock = vi.fn<() => Promise<void>>(() => Promise.resolve());

/** Lifecycle callbacks registered by the hook, in registration order. */
let mounts: Array<() => void> = [];
let unmounts: Array<() => void> = [];

vi.mock('@sigx/runtime-core', () => ({
    onMounted: (fn: () => void) => { mounts.push(fn); },
    onUnmounted: (fn: () => void) => { unmounts.push(fn); },
}));

vi.mock('@sigx/lynx-core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@sigx/lynx-core')>()),
    Orientation: { lock, unlock, isAvailable: () => true },
}));

const { useOrientationLock } = await import('../src/orientation-lock.js');

/** Register a holder and return its `unmount` thunk. */
function mountHolder(to: 'portrait' | 'landscape' | 'default'): () => void {
    const before = unmounts.length;
    useOrientationLock(to);
    mounts[mounts.length - 1]!();
    return unmounts[before]!;
}

beforeEach(() => {
    lock.mockClear();
    unlock.mockClear();
    mounts = [];
    unmounts = [];
});

describe('useOrientationLock', () => {
    it('locks on mount and releases on unmount', () => {
        const unmount = mountHolder('landscape');
        expect(lock).toHaveBeenCalledWith('landscape');

        unmount();
        expect(unlock).toHaveBeenCalled();
    });

    it("restores the covered screen's lock instead of unlocking", () => {
        const covered = mountHolder('portrait');
        const covering = mountHolder('landscape');
        expect(lock).toHaveBeenLastCalledWith('landscape');

        lock.mockClear();
        unlock.mockClear();
        // The covering screen pops. The covered one is still mounted, so its
        // lock comes back — the app does NOT fall through to the build default.
        covering();
        expect(lock).toHaveBeenLastCalledWith('portrait');
        expect(unlock).not.toHaveBeenCalled();

        // Only when the last holder goes does the runtime lock release.
        covered();
        expect(unlock).toHaveBeenCalled();
    });

    it('unwinds by holder identity, not by stack position', () => {
        const first = mountHolder('portrait');
        const second = mountHolder('landscape');

        lock.mockClear();
        unlock.mockClear();
        // Tearing down the OUTER holder first must leave the inner lock in
        // force — screens don't always unwind in LIFO order.
        first();
        expect(lock).toHaveBeenLastCalledWith('landscape');
        expect(unlock).not.toHaveBeenCalled();

        second();
        expect(unlock).toHaveBeenCalled();
    });

    it('is idempotent if the same holder unmounts twice', () => {
        const outer = mountHolder('portrait');
        const inner = mountHolder('landscape');

        inner();
        lock.mockClear();
        unlock.mockClear();
        inner(); // double-unmount must not pop the outer holder's entry
        expect(lock).not.toHaveBeenCalled();
        expect(unlock).not.toHaveBeenCalled();

        outer();
        expect(unlock).toHaveBeenCalled();
    });
});
