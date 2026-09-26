/**
 * Pilot components, wave 2 — the overlays (#1050): dialog through the
 * portal + backdrop + dismiss stack, popover through anchored positioning +
 * light dismiss, toast through the store + persistent viewport. Conformance
 * asserted while open (closed means unmounted on this platform).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import {
    Dialog, OverlayHost, Popover, Toast, clearDismissLayers, createToaster, dismissTopLayer, partBag,
} from '../src/index';
import { ForceStates, expectAnatomy, expectClassGrammar } from '../src/testing/index';

afterEach(() => clearDismissLayers());

const byPart = (root: TestNode, scope: string, part: string): TestNode | null => {
    const match = (n: TestNode): TestNode | null => {
        if (n.props['data-scope'] === scope && n.props['data-part'] === part) return n;
        for (const child of n.children) {
            const found = match(child);
            if (found) return found;
        }
        return null;
    };
    return match(root);
};

describe('Dialog', () => {
    const Probe = () => (
        <OverlayHost>
            <Dialog.Root color="primary">
                <Dialog.Trigger><text>Open</text></Dialog.Trigger>
                <Dialog.Popup>
                    <Dialog.Title>Confirm</Dialog.Title>
                    <Dialog.Description>Are you sure?</Dialog.Description>
                    <Dialog.Footer>
                        <Dialog.Close><text>Close</text></Dialog.Close>
                    </Dialog.Footer>
                </Dialog.Popup>
            </Dialog.Root>
        </OverlayHost>
    );

    it('opens through the trigger, conforms, closes through backdrop and Close', async () => {
        const { container } = render(<Probe />);
        expect(byPart(container, 'dialog', 'popup')).toBeNull();
        const trigger = byPart(container, 'dialog', 'trigger')!;
        await act(() => fireEvent.tap(trigger as never));
        await act(() => {});
        const popup = byPart(container, 'dialog', 'popup');
        expect(popup).not.toBeNull();
        // Axes flow THROUGH the portal into slot-rendered parts — the
        // PortalScope bridge is what makes this true.
        expect(byPart(container, 'dialog', 'title')!._class).toContain('zx-a-color-primary');
        expectAnatomy(container as never, anatomies.dialog);
        expectClassGrammar(container as never, anatomies.dialog);
        // The backdrop is a REAL part here — the pseudo projection.
        const backdrop = byPart(container, 'dialog', 'backdrop')!;
        expect(backdrop._class).toContain('zx-dialog__backdrop');
        await act(() => fireEvent.tap(backdrop as never));
        await act(() => {});
        expect(byPart(container, 'dialog', 'popup')).toBeNull();

        // Reopen, close via the Close part.
        await act(() => fireEvent.tap(trigger as never));
        await act(() => {});
        const close = byPart(container, 'dialog', 'close')!;
        await act(() => fireEvent.tap(close as never));
        await act(() => {});
        expect(byPart(container, 'dialog', 'popup')).toBeNull();
    });

    it('dismissible={false} ignores backdrop taps', async () => {
        const { container } = render(
            <OverlayHost>
                <Dialog.Root dismissible={false} defaultOpen>
                    <Dialog.Popup><Dialog.Title>Blocked</Dialog.Title></Dialog.Popup>
                </Dialog.Root>
            </OverlayHost>,
        );
        await act(() => {});
        const backdrop = byPart(container, 'dialog', 'backdrop')!;
        await act(() => fireEvent.tap(backdrop as never));
        await act(() => {});
        expect(byPart(container, 'dialog', 'popup')).not.toBeNull();
        // The layer stack still consumes a dismiss request (a back button
        // must not navigate while a modal is up) — but the dialog decides,
        // and deciding "no" means the popup STAYS UP after the consume.
        expect(dismissTopLayer()).toBe(true);
        await act(() => {});
        expect(byPart(container, 'dialog', 'popup')).not.toBeNull();
    });
});

describe('Popover', () => {
    it('anchors, stamps the resolved placement, light-dismisses', async () => {
        const { container } = render(
            <OverlayHost>
                <Popover.Root placement="bottom-start" defaultOpen>
                    <Popover.Trigger><text>Anchor</text></Popover.Trigger>
                    <Popover.Popup>
                        <Popover.Title>Details</Popover.Title>
                        <Popover.Close><text>x</text></Popover.Close>
                    </Popover.Popup>
                </Popover.Root>
            </OverlayHost>,
        );
        await act(() => {});
        const popup = byPart(container, 'popover', 'popup')!;
        expect(popup).not.toBeNull();
        expect(String(popup.props['data-placement'])).toBe('bottom-start');
        expect(popup._class).toContain('zx-p-bottom-start');
        expectAnatomy(container as never, anatomies.popover);
        expectClassGrammar(container as never, anatomies.popover);
        // Unmeasured → parked off-glass, never a 0,0 flash.
        expect(popup._style['top']).toBe('-10000px');
        // Tap the transparent outside surface (the popup's parent).
        await act(() => fireEvent.tap(popup.parent as never));
        await act(() => {});
        expect(byPart(container, 'popover', 'popup')).toBeNull();
    });

    // The component-level proof that nesting works end-to-end after the
    // normalizeChild fix (signalxjs/core#658, core 0.15.4): a Popover whose
    // Root lives INSIDE a Dialog's portaled Popup slot mounts through the
    // PortalScope bridge without cascading, and the layer stack dismisses
    // innermost-first. (The setup-count guard against the old remount
    // cascade lives in behaviors.test.tsx.)
    it('nested inside a dialog dismisses innermost-first', async () => {
        const { container } = render(
            <OverlayHost>
                <Dialog.Root defaultOpen>
                    <Dialog.Popup>
                        <Dialog.Title>Outer</Dialog.Title>
                        <Popover.Root>
                            <Popover.Trigger><text>More</text></Popover.Trigger>
                            <Popover.Popup>
                                <Popover.Title>Inner</Popover.Title>
                            </Popover.Popup>
                        </Popover.Root>
                    </Dialog.Popup>
                </Dialog.Root>
            </OverlayHost>,
        );
        await act(() => {});
        expect(byPart(container, 'dialog', 'popup')).not.toBeNull();

        // The popover's trigger is itself portaled slot content — opening it
        // from inside the dialog is the nesting that used to cascade.
        const trigger = byPart(container, 'popover', 'trigger')!;
        await act(() => fireEvent.tap(trigger as never));
        await act(() => {});
        expect(byPart(container, 'popover', 'popup')).not.toBeNull();
        expect(byPart(container, 'dialog', 'popup')).not.toBeNull();

        // Innermost-first: the popover registered its layer after the
        // dialog, so it consumes the first dismiss; the dialog the second.
        expect(dismissTopLayer()).toBe(true);
        await act(() => {});
        expect(byPart(container, 'popover', 'popup')).toBeNull();
        expect(byPart(container, 'dialog', 'popup')).not.toBeNull();

        expect(dismissTopLayer()).toBe(true);
        await act(() => {});
        expect(byPart(container, 'dialog', 'popup')).toBeNull();
    });
});

const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('Toast', () => {
    it('presence and expiry are the store\'s job — tested headlessly under fake timers', () => {
        // Fake timers + the renderer's act() starve each other, so the
        // TIMED half never mixes with rendering: the store alone owns it.
        vi.useFakeTimers();
        try {
            const toaster = createToaster({ exitDuration: 200 });
            toaster.show({ title: 'Saved', duration: 4000 });
            toaster.show({ title: 'Sticky', duration: 0 });
            expect(toaster.toasts().map((t) => t.title)).toEqual(['Saved', 'Sticky']);
            // Created closed, open one frame later — the entry transition.
            expect(toaster.toasts().map((t) => t.open)).toEqual([false, false]);
            vi.advanceTimersByTime(16);
            expect(toaster.toasts().map((t) => t.open)).toEqual([true, true]);
            // Expiry flips to closed and keeps the node for the exit...
            vi.advanceTimersByTime(4000 - 16);
            expect(toaster.toasts().map((t) => [t.title, t.open])).toEqual([['Saved', false], ['Sticky', true]]);
            // ...a second dismiss during the exit is a no-op...
            toaster.dismiss(toaster.toasts()[0]!.id);
            vi.advanceTimersByTime(200);
            // ...then removes it.
            expect(toaster.toasts().map((t) => t.title)).toEqual(['Sticky']);
            toaster.remove(toaster.toasts()[0]!.id);
            expect(toaster.toasts()).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('a toast dismissed before it opens never opens', () => {
        vi.useFakeTimers();
        try {
            const toaster = createToaster({ exitDuration: 0 });
            const id = toaster.show({ title: 'Gone', duration: 0 });
            const kept = toaster.show({ title: 'Kept', duration: 0 });
            toaster.dismiss(id);
            vi.advanceTimersByTime(16);
            expect(toaster.toasts().map((t) => [t.id, t.open])).toEqual([[kept, true]]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('renders through the viewport, stamps placement, dismisses via close', async () => {
        const toaster = createToaster({ exitDuration: 0 });
        const { container } = render(
            <OverlayHost>
                <Toast.Viewport placement="top-end" toaster={toaster} />
            </OverlayHost>,
        );
        await act(() => {});
        expect(byPart(container, 'toast', 'viewport')).toBeNull();

        await act(() => { toaster.show({ title: 'Saved', description: 'All good', duration: 0 }); });
        await act(() => settle(40));
        const viewport = byPart(container, 'toast', 'viewport')!;
        expect(viewport).not.toBeNull();
        expect(String(viewport.props['data-placement'])).toBe('top-end');
        // The skin's web centering (left:50% + translateX(-50%)) must not
        // survive under the full-width strip — it shifted the viewport left.
        expect(viewport._style['transform']).toBe('none');
        expect(viewport._style['display']).toBe('flex');
        expect(container.textContent()).toContain('Saved');
        const root = byPart(container, 'toast', 'root')!;
        expect(String(root.props['data-state'])).toBe('open');
        expect(String(root.props['data-placement'])).toBe('top-end');
        expectAnatomy(container as never, anatomies.toast);
        expectClassGrammar(container as never, anatomies.toast);

        const close = byPart(container, 'toast', 'close')!;
        expect(close.props['accessibility-label']).toBe('Dismiss');
        await act(() => fireEvent.tap(close as never));
        await act(() => {});
        expect(byPart(container, 'toast', 'viewport')).toBeNull();
    });

    it('the stock composition carries color, size and an action', async () => {
        const toaster = createToaster({ exitDuration: 0 });
        let acted = 0;
        const { container } = render(
            <OverlayHost>
                <Toast.Viewport toaster={toaster} size="lg" />
            </OverlayHost>,
        );
        await act(() => {
            toaster.show({ title: 'Deleted', color: 'error', action: { label: 'Undo', onPress: () => acted++ }, duration: 0 });
        });
        await act(() => settle(40));
        const root = byPart(container, 'toast', 'root')!;
        expect(root._class).toContain('zx-a-color-error');
        expect(root._class).toContain('zx-a-size-lg');
        // Default placement is bottom.
        expect(String(byPart(container, 'toast', 'viewport')!.props['data-placement'])).toBe('bottom');
        const action = byPart(container, 'toast', 'action')!;
        expect(action._class).toContain('zx-a-color-error');
        expect(container.textContent()).toContain('Undo');
        await act(() => fireEvent.touchStart(action as never));
        expect(action._class).toContain('zx-f-pressed');
        await act(() => fireEvent.touchEnd(action as never));
        await act(() => fireEvent.tap(action as never));
        expect(acted).toBe(1);
        expectAnatomy(container as never, anatomies.toast);
        expectClassGrammar(container as never, anatomies.toast);
    });

    it('an enclosing ForceStates reaches the portaled cards', async () => {
        const toaster = createToaster();
        const { container } = render(
            <OverlayHost>
                <ForceStates flags={{ pressed: true }} parts={['close']}>
                    <Toast.Viewport toaster={toaster} />
                </ForceStates>
            </OverlayHost>,
        );
        await act(() => { toaster.show({ title: 'Held', duration: 0 }); });
        await act(() => settle(40));
        expect(byPart(container, 'toast', 'close')!._class).toContain('zx-f-pressed');
        expect(byPart(container, 'toast', 'root')!._class).not.toContain('zx-f-pressed');
    });

    it('the parts compose in place, outside any viewport', async () => {
        let dismissed = 0;
        // A static viewport part keeps the anatomy's part tree (root inside
        // viewport) — the state-matrix gallery draws its cells the same way.
        const { container } = render(
            <view {...partBag(anatomies.toast, 'viewport', {})}>
                <ForceStates flags={{ 'focus-visible': true }} parts={['action']}>
                    <Toast.Root color="info" size="sm" onDismiss={() => dismissed++}>
                        <Toast.Title>In place</Toast.Title>
                        <Toast.Description>No store, no portal.</Toast.Description>
                        <Toast.Action disabled label="Retry"><text>Retry</text></Toast.Action>
                        <Toast.Close label="Close it"><text>x</text></Toast.Close>
                    </Toast.Root>
                </ForceStates>
            </view>,
        );
        const root = byPart(container, 'toast', 'root')!;
        expect(String(root.props['data-state'])).toBe('open');
        expect(root.props['data-placement']).toBeUndefined();
        expect(byPart(container, 'toast', 'title')!._class).toContain('zx-a-color-info');
        const action = byPart(container, 'toast', 'action')!;
        expect(action._class).toContain('zx-f-disabled');
        expect(action._class).toContain('zx-f-focus-visible');
        expect(action.props['accessibility-status']).toBe('disabled');
        await act(() => fireEvent.touchStart(action as never));
        expect(action._class).not.toContain('zx-f-pressed');
        expectAnatomy(container as never, anatomies.toast);
        expectClassGrammar(container as never, anatomies.toast);
        const close = byPart(container, 'toast', 'close')!;
        expect(close.props['accessibility-label']).toBe('Close it');
        await act(() => fireEvent.tap(close as never));
        expect(dismissed).toBe(1);
    });
});
