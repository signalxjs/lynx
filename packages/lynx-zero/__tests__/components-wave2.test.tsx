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
    Dialog, OverlayHost, Popover, Toast, clearDismissLayers, createToaster, dismissTopLayer,
} from '../src/index';
import { expectAnatomy, expectClassGrammar } from '../src/testing/index';

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
        const backdrop = byPart(container, 'toast', 'viewport') === null
            ? byPart(container, 'dialog', 'backdrop')!
            : null!;
        await act(() => fireEvent.tap(backdrop as never));
        await act(() => {});
        expect(byPart(container, 'dialog', 'popup')).not.toBeNull();
        // The layer stack still consumes a dismiss request (a back button
        // must not navigate while a modal is up) — but the dialog decides.
        expect(dismissTopLayer()).toBe(true);
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

    // An overlay Root INSIDE another overlay's portaled slot remounts on
    // every outlet turn and cascades (signalxjs/lynx#1051 — a sigx-core
    // reconciliation question). Until settled, the inner overlay's Root
    // lives OUTSIDE the outer's Popup slot; innermost-first dismissal is
    // already covered at the behavior layer (behaviors.test.tsx).
    it.todo('nested inside a dialog dismisses innermost-first (blocked on signalxjs/lynx#1051)');
});

describe('Toast', () => {
    it('expiry is the store\'s job — tested headlessly under fake timers', () => {
        // Fake timers + the renderer's act() starve each other, so the
        // TIMED half never mixes with rendering: the store alone owns it.
        vi.useFakeTimers();
        try {
            const toaster = createToaster();
            toaster.show({ title: 'Saved', duration: 4000 });
            toaster.show({ title: 'Sticky', duration: 0 });
            expect(toaster.toasts().map((t) => t.title)).toEqual(['Saved', 'Sticky']);
            vi.advanceTimersByTime(4000);
            expect(toaster.toasts().map((t) => t.title)).toEqual(['Sticky']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('renders through the viewport, stamps placement, dismisses via close', async () => {
        const toaster = createToaster();
        const { container } = render(
            <OverlayHost>
                <Toast.Viewport placement="top-end" toaster={toaster} />
            </OverlayHost>,
        );
        await act(() => {});
        expect(byPart(container, 'toast', 'viewport')).toBeNull();

        await act(() => { toaster.show({ title: 'Saved', description: 'All good', duration: 0 }); });
        await act(() => {});
        const viewport = byPart(container, 'toast', 'viewport')!;
        expect(viewport).not.toBeNull();
        expect(String(viewport.props['data-placement'])).toBe('top-end');
        expect(container.textContent()).toContain('Saved');
        expectAnatomy(container as never, anatomies.toast);
        expectClassGrammar(container as never, anatomies.toast);

        const close = byPart(container, 'toast', 'close')!;
        await act(() => fireEvent.tap(close as never));
        await act(() => {});
        expect(byPart(container, 'toast', 'viewport')).toBeNull();
    });
});
