import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, fireEvent, waitForUpdate, TestNode } from '@sigx/lynx-testing';
import { UpdateGate } from '../src/UpdateGate';
import { UpdatePrompt } from '../src/UpdatePrompt';
import { UpdateProgress } from '../src/UpdateProgress';
import { UpdateReadyBanner } from '../src/UpdateReadyBanner';
import { isDismissed, dismiss } from '../src/dismissals';
import { mockStore, makeManifest, resetUpdatesMock, UpdatesMock } from './updates-mock';

// Replace the headless package with the controllable mock store — the
// simplest test seam (the real store isn't exported publicly).
vi.mock('@sigx/lynx-updates', async () => {
    const m = await import('./updates-mock');
    return {
        Updates: m.UpdatesMock,
        useUpdates: m.useUpdatesMock,
        UpdatesError: class UpdatesError extends Error {},
    };
});

// The real <Pressable> is an MT gesture recognizer the BG test harness can't
// drive (same constraint noted in daisyui's NavTabBar tests). Swap it for a
// plain bindtap view so fireEvent.tap() reaches Button onPress handlers.
vi.mock('@sigx/lynx-gestures', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sigx/lynx-gestures')>();
    const { component } = await import('@sigx/lynx');
    const { jsx } = await import('@sigx/lynx/jsx-runtime');
    const Pressable = (component as (setup: (ctx: any) => () => unknown) => any)(
        ({ props, slots, emit }: any) => () =>
            jsx('view', {
                class: props.class,
                bindtap: () => {
                    if (!props.disabled) emit('press');
                },
                children: slots.default?.(),
            }),
    );
    return { ...actual, Pressable };
});

/** Find the innermost tappable node whose subtree contains the given text. */
function findPressable(root: TestNode, text: string): TestNode | null {
    let found: TestNode | null = null;
    const walk = (node: TestNode) => {
        if (node._handlers.has('bindtap') && node.textContent().includes(text)) found = node;
        for (const child of node.children) walk(child);
    };
    walk(root);
    return found;
}

beforeEach(() => {
    resetUpdatesMock();
});

describe('UpdateGate', () => {
    it('renders children and no overlay when not mandatory', () => {
        const { queryByText, unmount } = render(
            <UpdateGate>
                <text>app content</text>
            </UpdateGate>,
        );
        expect(queryByText('app content')).toBeTruthy();
        expect(queryByText('Update required')).toBeNull();
        unmount();
    });

    it('blocks with title, description and progress when mandatory', async () => {
        const { container, queryByText, unmount } = render(
            <UpdateGate description="Please wait while we update.">
                <text>app content</text>
            </UpdateGate>,
        );
        await act(() => {
            mockStore.mandatory = true;
            mockStore.status = 'downloading';
            mockStore.manifest = makeManifest('m-1', { mandatory: true });
            mockStore.progress = { receivedBytes: 50, totalBytes: 100 };
        });
        expect(queryByText('Update required')).toBeTruthy();
        expect(queryByText('Please wait while we update.')).toBeTruthy();
        const bar = container.findByType('view');
        expect(bar).toBeTruthy();
        // Progress bar bound to state.progress: 50/100 → 50% width.
        const progressBars = container
            .findAllByType('view')
            .filter((n) => n._class.includes('progress-bar'));
        expect(progressBars).toHaveLength(1);
        expect(progressBars[0]._style.width).toBe('50%');
        unmount();
    });

    it('custom title prop and Installing… while applying', async () => {
        const { queryByText, unmount } = render(
            <UpdateGate title="Hold tight">
                <text>app content</text>
            </UpdateGate>,
        );
        await act(() => {
            mockStore.mandatory = true;
            mockStore.status = 'applying';
            mockStore.manifest = makeManifest('m-2', { mandatory: true });
        });
        expect(queryByText('Hold tight')).toBeTruthy();
        expect(queryByText('Installing…')).toBeTruthy();
        unmount();
    });

    it('shows Retry on error and re-triggers the download', async () => {
        const { container, queryByText, unmount } = render(
            <UpdateGate>
                <text>app content</text>
            </UpdateGate>,
        );
        await act(() => {
            mockStore.mandatory = true;
            mockStore.status = 'error';
            mockStore.manifest = makeManifest('m-3', { mandatory: true });
        });
        expect(queryByText('Retry')).toBeTruthy();
        const retry = findPressable(container, 'Retry');
        expect(retry).toBeTruthy();
        await act(() => {
            fireEvent.tap(retry!);
        });
        expect(UpdatesMock.download).toHaveBeenCalledTimes(1);
        unmount();
    });

    it('renders the blocked slot instead of the built-in overlay', async () => {
        const { queryByText, unmount } = render(
            <UpdateGate slots={{ blocked: () => <text>custom blocked</text> }}>
                <text>app content</text>
            </UpdateGate>,
        );
        await act(() => {
            mockStore.mandatory = true;
            mockStore.status = 'downloading';
        });
        expect(queryByText('custom blocked')).toBeTruthy();
        expect(queryByText('Update required')).toBeNull();
        unmount();
    });
});

describe('UpdatePrompt', () => {
    it('is hidden while idle', () => {
        const { queryByText, unmount } = render(<UpdatePrompt />);
        expect(queryByText('Update available')).toBeNull();
        unmount();
    });

    it('shows version + release notes when a non-mandatory update is available', async () => {
        const { queryByText, unmount } = render(<UpdatePrompt />);
        await act(() => {
            mockStore.status = 'available';
            mockStore.manifest = makeManifest('p-1');
        });
        await waitForUpdate(); // async dismissal check → visible
        expect(queryByText('Update available')).toBeTruthy();
        expect(queryByText('Version 1.2.3')).toBeTruthy();
        expect(queryByText('Bug fixes and improvements')).toBeTruthy();
        unmount();
    });

    it('stays hidden for mandatory updates and non-available statuses', async () => {
        const { queryByText, unmount } = render(<UpdatePrompt />);
        await act(() => {
            mockStore.status = 'available';
            mockStore.mandatory = true;
            mockStore.manifest = makeManifest('p-2', { mandatory: true });
        });
        await waitForUpdate();
        expect(queryByText('Update available')).toBeNull();

        await act(() => {
            mockStore.mandatory = false;
            mockStore.status = 'downloading';
        });
        await waitForUpdate();
        expect(queryByText('Update available')).toBeNull();
        unmount();
    });

    it('Update downloads; applyOn="restart" applies after the download', async () => {
        const { container, unmount } = render(<UpdatePrompt applyOn="restart" />);
        await act(() => {
            mockStore.status = 'available';
            mockStore.manifest = makeManifest('p-3');
        });
        await waitForUpdate();
        const update = findPressable(container, 'Update');
        expect(update).toBeTruthy();
        await act(() => {
            fireEvent.tap(update!);
        });
        expect(UpdatesMock.download).toHaveBeenCalledTimes(1);
        expect(UpdatesMock.apply).toHaveBeenCalledTimes(1);
        unmount();
    });

    it('Update with the default applyOn (next-launch) does not apply', async () => {
        const { container, unmount } = render(<UpdatePrompt />);
        await act(() => {
            mockStore.status = 'available';
            mockStore.manifest = makeManifest('p-4');
        });
        await waitForUpdate();
        const update = findPressable(container, 'Update');
        await act(() => {
            fireEvent.tap(update!);
        });
        expect(UpdatesMock.download).toHaveBeenCalledTimes(1);
        expect(UpdatesMock.apply).not.toHaveBeenCalled();
        unmount();
    });

    it('Later dismisses, emits onDismiss, and suppresses re-prompts for that id', async () => {
        const onDismiss = vi.fn();
        const { container, queryByText, unmount } = render(<UpdatePrompt onDismiss={onDismiss} />);
        await act(() => {
            mockStore.status = 'available';
            mockStore.manifest = makeManifest('p-5');
        });
        await waitForUpdate();
        expect(queryByText('Update available')).toBeTruthy();

        const later = findPressable(container, 'Later');
        await act(() => {
            fireEvent.tap(later!);
        });
        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(queryByText('Update available')).toBeNull();

        // Same update id surfaces again → still suppressed.
        await act(() => {
            mockStore.status = 'idle';
        });
        await act(() => {
            mockStore.status = 'available';
        });
        await waitForUpdate();
        expect(queryByText('Update available')).toBeNull();
        unmount();
    });
});

describe('UpdateProgress', () => {
    it('renders nothing visible unless downloading', () => {
        const { container, unmount } = render(<UpdateProgress />);
        const placeholder = container.children[0];
        expect(placeholder._style.width).toBe('0px');
        expect(placeholder._style.height).toBe('0px');
        unmount();
    });

    it('shows the bar and percent while downloading', async () => {
        const { container, queryByText, unmount } = render(<UpdateProgress />);
        await act(() => {
            mockStore.status = 'downloading';
            mockStore.manifest = makeManifest('d-1');
            mockStore.progress = { receivedBytes: 25, totalBytes: 100 };
        });
        expect(queryByText('25%')).toBeTruthy();
        const bar = container
            .findAllByType('view')
            .find((n) => n._class.includes('progress-bar'));
        expect(bar?._style.width).toBe('25%');
        unmount();
    });

    it('falls back to received bytes when total size is unknown', async () => {
        const { queryByText, unmount } = render(<UpdateProgress />);
        await act(() => {
            mockStore.status = 'downloading';
            mockStore.progress = { receivedBytes: 2048, totalBytes: null };
        });
        expect(queryByText('2 KB')).toBeTruthy();
        unmount();
    });
});

describe('UpdateReadyBanner', () => {
    it('is hidden until status is ready', () => {
        const { queryByText, unmount } = render(<UpdateReadyBanner />);
        expect(queryByText('Update ready')).toBeNull();
        unmount();
    });

    it('shows label + version and restarts via Updates.apply()', async () => {
        const { container, queryByText, unmount } = render(<UpdateReadyBanner />);
        await act(() => {
            mockStore.status = 'ready';
            mockStore.manifest = makeManifest('r-1');
        });
        expect(queryByText('Update ready — v1.2.3')).toBeTruthy();

        const restart = findPressable(container, 'Restart');
        expect(restart).toBeTruthy();
        await act(() => {
            fireEvent.tap(restart!);
        });
        expect(UpdatesMock.apply).toHaveBeenCalledTimes(1);
        unmount();
    });

    it('stays hidden for mandatory updates (the gate owns those)', async () => {
        const { queryByText, unmount } = render(<UpdateReadyBanner />);
        await act(() => {
            mockStore.status = 'ready';
            mockStore.mandatory = true;
            mockStore.manifest = makeManifest('r-2', { mandatory: true });
        });
        expect(queryByText('Update ready')).toBeNull();
        unmount();
    });

    it('Later hides the banner and emits onDismiss', async () => {
        const onDismiss = vi.fn();
        const { container, queryByText, unmount } = render(<UpdateReadyBanner onDismiss={onDismiss} />);
        await act(() => {
            mockStore.status = 'ready';
            mockStore.manifest = makeManifest('r-3');
        });
        const later = findPressable(container, 'Later');
        await act(() => {
            fireEvent.tap(later!);
        });
        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(queryByText('Update ready')).toBeNull();
        unmount();
    });
});

describe('dismissals', () => {
    it('records and reads dismissals (in-memory fallback without native Storage)', async () => {
        expect(await isDismissed('fresh-id')).toBe(false);
        await dismiss('fresh-id');
        expect(await isDismissed('fresh-id')).toBe(true);
    });

    it('treats empty ids as never dismissed', async () => {
        await dismiss('');
        expect(await isDismissed('')).toBe(false);
    });
});
