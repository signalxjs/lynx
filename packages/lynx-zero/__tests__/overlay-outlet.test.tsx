/**
 * The full-window overlay outlet (#1169). The host used to BE the outlet, so
 * every overlay was confined to the host's box — inside a SafeAreaView's
 * padding, a dialog backdrop left the status-bar and home-indicator strips
 * undimmed and a bottom toast's shadow was cut at the inset. The outlet is
 * now a `position: fixed` layer (lynx attaches it to the page root: no
 * clipping ancestor, the whole window), and the host's own box is the SAFE
 * FRAME the content respects.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ElementLayout } from '@sigx/lynx';
import { component, effect } from '@sigx/lynx';
import { act, render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import {
    Dialog, OverlayHost, Toast, clearDismissLayers, computeOverlayInsets, containedFrame, createToaster,
    provideOverlayOrigin, useOverlayPortal,
} from '../src/index';
import { computeFramedPosition, computeOutletPosition } from '../src/behaviors/position';

afterEach(() => clearDismissLayers());

const rect = (top: number, left: number, width: number, height: number): ElementLayout => ({
    top, left, width, height, right: left + width, bottom: top + height,
});

// An iPhone-ish window, and the host inside a SafeAreaView's padding.
const WINDOW = rect(0, 0, 402, 874);
const SAFE = rect(62, 0, 402, 874 - 62 - 34);

const byPart = (root: TestNode, scope: string, part: string): TestNode | null => {
    if (root.props['data-scope'] === scope && root.props['data-part'] === part) return root;
    for (const child of root.children) {
        const hit = byPart(child, scope, part);
        if (hit) return hit;
    }
    return null;
};

/** Stands in for the host's measurements (the MT round-trip never lands in tests). */
const FakeOrigin = component<{ outlet: ElementLayout | null; frame: ElementLayout | null }>(({ props, slots }) => {
    provideOverlayOrigin(() => props.outlet, () => {}, () => props.frame);
    return () => slots.default?.() as never;
});

describe('containedFrame / computeOverlayInsets', () => {
    it('the safe frame inside the window yields the inset strips', () => {
        expect(computeOverlayInsets(WINDOW, SAFE)).toEqual({ top: 62, right: 0, bottom: 34, left: 0 });
    });

    it('landscape: the notch and home-indicator sides', () => {
        const window = rect(0, 0, 874, 402);
        const frame = rect(0, 62, 874 - 124, 402 - 21);
        expect(computeOverlayInsets(window, frame)).toEqual({ top: 0, right: 62, bottom: 21, left: 62 });
    });

    it('a frame measured mid push-transition (poking out of the window) is ignored — zero insets', () => {
        const sliding = rect(62, 300, 402, 778);
        expect(containedFrame(WINDOW, sliding)).toBeNull();
        expect(computeOverlayInsets(WINDOW, sliding)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    });

    it('unknown rects give zero insets', () => {
        expect(computeOverlayInsets(null, SAFE)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
        expect(computeOverlayInsets(WINDOW, null)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
        expect(computeOverlayInsets(WINDOW, rect(0, 0, 0, 0))).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    });

    it('tolerates sub-pixel rounding at the edges', () => {
        expect(containedFrame(WINDOW, rect(-0.5, 0, 402.5, 874.4))).not.toBeNull();
    });
});

describe('computeFramedPosition — anchored popups clamp to the safe frame (#1086 kept)', () => {
    const floating = { width: 100, height: 200 };
    const screen = { width: 402, height: 874 };

    it('is computeOutletPosition when there is no usable frame', () => {
        const anchor = rect(300, 20, 80, 40);
        expect(computeFramedPosition(anchor, floating, WINDOW, null, screen, { placement: 'bottom-start' }))
            .toEqual(computeOutletPosition(anchor, floating, WINDOW, screen, { placement: 'bottom-start' }));
    });

    it('places in outlet (window) coordinates', () => {
        const anchor = rect(300, 20, 80, 40);
        expect(computeFramedPosition(anchor, floating, WINDOW, SAFE, screen, { placement: 'bottom-start' }))
            .toEqual({ top: 344, left: 20, placement: 'bottom-start' });
    });

    it('flips against the frame bottom, not the window bottom (the home-indicator strip is not room)', () => {
        // 190 below the anchor to the window edge, but only 156 to the frame's.
        const anchor = rect(650, 20, 80, 34);
        const p = computeFramedPosition(anchor, floating, WINDOW, SAFE, screen, { placement: 'bottom-start' });
        expect(p.placement).toBe('top-start');
        expect(p.top).toBe(650 - 4 - 200);
    });
});

describe('OverlayHost — the outlet layer', () => {
    it('renders no layer while nothing is open', () => {
        const { container } = render(
            <OverlayHost>
                <text>content</text>
            </OverlayHost>,
        );
        const host = container.children[0]!;
        expect(host.children.some((n) => n._style?.position === 'fixed')).toBe(false);
    });

    it('an open overlay mounts in a full-window fixed layer, last in the host, transparent to its own touches', async () => {
        const Owner = component(() => {
            const portal = useOverlayPortal();
            effect(() => portal.show(() => <text>overlay</text>));
            return () => <text>content</text>;
        });
        const { container } = render(
            <OverlayHost>
                <Owner />
            </OverlayHost>,
        );
        await act(() => {});
        const host = container.children[0]!;
        const layer = host.children.filter((n) => n._style?.position === 'fixed').at(-1)!;
        expect(host.children.filter((n) => n._style?.position === 'fixed').length).toBe(1);
        // Last element child: document order is paint order.
        expect(host.children.indexOf(layer)).toBeGreaterThan(host.children.findIndex((n) => n.textContent() === 'content'));
        expect(layer._style.position).toBe('fixed');
        expect([layer._style.top, layer._style.left, layer._style.right, layer._style.bottom]).toEqual([0, 0, 0, 0]);
        expect(layer._style.pointerEvents).toBe('none');
        expect(layer.textContent()).toBe('overlay');
        // The host stays the page's flex column (#1064).
        expect(host._style.position).toBe('relative');
        expect(host._style.display).toBe('flex');
    });
});

describe('Dialog — the backdrop fills the window, the panel respects the frame', () => {
    it('pads the backdrop by the safe-frame insets', async () => {
        const { container } = render(
            <OverlayHost>
                <FakeOrigin outlet={WINDOW} frame={SAFE}>
                    <Dialog.Root defaultOpen>
                        <Dialog.Popup><Dialog.Title>T</Dialog.Title></Dialog.Popup>
                    </Dialog.Root>
                </FakeOrigin>
            </OverlayHost>,
        );
        await act(() => {});
        const backdrop = byPart(container, 'dialog', 'backdrop')!;
        expect(backdrop).not.toBeNull();
        expect([backdrop._style.top, backdrop._style.right, backdrop._style.bottom, backdrop._style.left]).toEqual([0, 0, 0, 0]);
        expect(backdrop._style.paddingTop).toBe('62px');
        expect(backdrop._style.paddingBottom).toBe('34px');
        expect(backdrop._style.paddingLeft).toBe('0px');
        expect(backdrop._style.paddingRight).toBe('0px');
    });

    it('with no measurements yet, the backdrop is unpadded (the whole window)', async () => {
        const { container } = render(
            <OverlayHost>
                <Dialog.Root defaultOpen>
                    <Dialog.Popup><Dialog.Title>T</Dialog.Title></Dialog.Popup>
                </Dialog.Root>
            </OverlayHost>,
        );
        await act(() => {});
        const backdrop = byPart(container, 'dialog', 'backdrop')!;
        expect(backdrop._style.paddingTop).toBe('0px');
        expect(backdrop._style.paddingBottom).toBe('0px');
    });
});

describe('Toast — the viewport pins to the safe frame', () => {
    it('bottom placement sits on the frame bottom, not the window bottom', async () => {
        const toaster = createToaster();
        const { container } = render(
            <OverlayHost>
                <FakeOrigin outlet={WINDOW} frame={SAFE}>
                    <Toast.Viewport toaster={toaster} placement="bottom" />
                </FakeOrigin>
            </OverlayHost>,
        );
        await act(() => { toaster.show({ title: 'Saved' }); });
        await act(() => {});
        const viewport = byPart(container, 'toast', 'viewport')!;
        expect(viewport).not.toBeNull();
        expect(viewport._style.position).toBe('absolute');
        expect(viewport._style.bottom).toBe('34px');
        expect(viewport._style.left).toBe('0px');
        expect(viewport._style.right).toBe('0px');
        expect(viewport._style.top).toBeUndefined();
    });

    it('top placement clears the status bar', async () => {
        const toaster = createToaster();
        const { container } = render(
            <OverlayHost>
                <FakeOrigin outlet={WINDOW} frame={SAFE}>
                    <Toast.Viewport toaster={toaster} placement="top-end" />
                </FakeOrigin>
            </OverlayHost>,
        );
        await act(() => { toaster.show({ title: 'Saved' }); });
        await act(() => {});
        const viewport = byPart(container, 'toast', 'viewport')!;
        expect(viewport._style.top).toBe('62px');
        expect(viewport._style.bottom).toBeUndefined();
    });
});
