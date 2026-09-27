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
import { component, effect, signal } from '@sigx/lynx';
import { act, render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import {
    Dialog, OVERLAY_ROOT_STYLE, OverlayHost, Popover, Select, Toast, clearDismissLayers, computeOverlayInsets,
    containedFrame, createToaster, fixedOutletRect, provideOverlayOrigin, useOverlayInsets, useOverlayPortal,
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

/** The outlet layer: fixed, 0×0 (#1190). */
const isLayer = (n: TestNode): boolean => n._style?.position === 'fixed' && n._style?.width === 0;
/** The window-sized measuring node: fixed on all four edges. */
const isSizer = (n: TestNode): boolean => n._style?.position === 'fixed' && n._style?.right === 0;

describe('OverlayHost — the outlet layer', () => {
    it('keeps the layer mounted but display:none while nothing is open (#1181)', () => {
        const { container } = render(
            <OverlayHost>
                <text>content</text>
            </OverlayHost>,
        );
        const host = container.children[0]!;
        const layers = host.children.filter(isLayer);
        expect(layers.length).toBe(1);
        expect(layers[0]!._style.display).toBe('none');
        expect(layers[0]!._style.pointerEvents).toBe('none');
    });

    it('opening and closing flips display on the SAME fixed node — never re-inserts it (#1181)', async () => {
        const open = signal({ value: false });
        const Owner = component(() => {
            const portal = useOverlayPortal();
            effect(() => {
                if (open.value) portal.show(() => <view style={OVERLAY_ROOT_STYLE}><text>overlay</text></view>);
                else portal.hide();
            });
            return () => <text>content</text>;
        });
        const { container } = render(
            <OverlayHost>
                <Owner />
            </OverlayHost>,
        );
        await act(() => {});
        const host = container.children[0]!;
        const layer = host.children.find(isLayer)!;
        const sizer = host.children.find(isSizer)!;
        expect(layer._style.display).toBe('none');
        await act(() => { open.value = true; });
        await act(() => {});
        expect(host.children.find(isLayer)).toBe(layer);
        expect(host.children.find(isSizer)).toBe(sizer);
        expect(layer._style.display).toBe('flex');
        expect(layer.textContent()).toBe('overlay');
        await act(() => { open.value = false; });
        await act(() => {});
        expect(host.children.find(isLayer)).toBe(layer);
        expect(layer._style.display).toBe('none');
        expect(elementsOf(layer).length).toBe(0);
    });

    it('an open overlay mounts in a zero-size fixed layer, last in the host, transparent to its own touches', async () => {
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
        const layer = host.children.find(isLayer)!;
        expect(host.children.filter(isLayer).length).toBe(1);
        expect(layer._style.display).toBe('flex');
        // Last element child: document order is paint order.
        expect(host.children.indexOf(layer)).toBe(host.children.length - 1);
        expect(host.children.indexOf(layer)).toBeGreaterThan(host.children.findIndex((n) => n.textContent() === 'content'));
        // 0×0 at the origin, children painting out of it (#1190).
        expect([layer._style.top, layer._style.left, layer._style.width, layer._style.height]).toEqual([0, 0, 0, 0]);
        expect(layer._style.overflow).toBe('visible');
        expect(layer._style.right).toBeUndefined();
        expect(layer._style.bottom).toBeUndefined();
        expect(layer._style.pointerEvents).toBe('none');
        expect(layer.textContent()).toBe('overlay');
        // The host stays the page's flex column (#1064).
        expect(host._style.position).toBe('relative');
        expect(host._style.display).toBe('flex');
    });

    it('the window size comes from a childless sizer that is out of BOTH hit-tests (#1190)', () => {
        const { container } = render(
            <OverlayHost>
                <text>content</text>
            </OverlayHost>,
        );
        const host = container.children[0]!;
        const sizers = host.children.filter(isSizer);
        expect(sizers.length).toBe(1);
        const sizer = sizers[0]!;
        expect([sizer._style.top, sizer._style.left, sizer._style.right, sizer._style.bottom]).toEqual([0, 0, 0, 0]);
        expect(sizer._style.pointerEvents).toBe('none');
        expect(sizer.props['native-interaction-enabled']).toBe(false);
        expect(elementsOf(sizer).length).toBe(0);
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
        // The layer is 0×0 (#1190): the backdrop states the window's size.
        expect([backdrop._style.top, backdrop._style.left]).toEqual([0, 0]);
        expect([backdrop._style.width, backdrop._style.height]).toEqual(['402px', '874px']);
        expect(backdrop.props['native-interaction-enabled']).toBeUndefined();
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
        // Pinned by its top at the frame's bottom edge, lifted by its own
        // height: `bottom` against the 0×0 layer would mean nothing (#1190).
        expect(viewport._style.top).toBe(`${874 - 34}px`);
        expect(viewport._style.transform).toBe('translateY(-100%)');
        expect(viewport._style.bottom).toBeUndefined();
        expect(viewport._style.left).toBe('0px');
        expect(viewport._style.width).toBe('402px');
        expect(viewport._style.height).toBe('max-content');
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
        expect(viewport._style.transform).toBe('none');
    });
});

/** A node's element children (no text or comment anchors). */
function elementsOf(node: TestNode): TestNode[] {
    return node.children.filter((n) => !n.type.startsWith('#'));
}

/** Every node in the subtree, depth first. */
const walk = (node: TestNode, out: TestNode[] = []): TestNode[] => {
    out.push(node);
    for (const child of node.children) walk(child, out);
    return out;
};

/**
 * What both engines do with `pointer-events` (LynxUI.pointerEvents on iOS,
 * LynxBaseUI.pointerEvents() on Android): a node without its own value
 * reports its nearest ancestor's; `auto` at the top.
 */
const effectivePointerEvents = (root: TestNode, target: TestNode): string => {
    const path: TestNode[] = [];
    const find = (node: TestNode): boolean => {
        path.push(node);
        if (node === target) return true;
        for (const child of node.children) if (find(child)) return true;
        path.pop();
        return false;
    };
    if (!find(root)) throw new Error('target not in tree');
    for (let i = path.length - 1; i >= 0; i--) {
        const v = path[i]!._style?.pointerEvents;
        if (v !== undefined) return String(v);
    }
    return 'auto';
};

describe('event routing contract (#1180): the layer passes touches through, overlays take their own', () => {
    const layerOf = (container: TestNode): TestNode => walk(container).find(isLayer)!;

    /** Every tappable node under the layer resolves to `auto`; the layer itself to `none`. */
    const expectRouting = (container: TestNode): void => {
        const layer = layerOf(container);
        expect(effectivePointerEvents(container, layer)).toBe('none');
        const roots = elementsOf(layer);
        expect(roots.length).toBeGreaterThan(0);
        for (const root of roots) {
            // The root of every portal closure opts back in EXPLICITLY — an
            // inherited value would be the layer's `none`.
            expect(root._style.pointerEvents).toBe('auto');
            for (const node of walk(root).filter((n) => !n.type.startsWith('#'))) {
                expect(effectivePointerEvents(container, node)).toBe('auto');
            }
        }
    };

    it('the page content under the layer is untouched (auto)', async () => {
        const { container } = render(
            <OverlayHost>
                <view><text>content</text></view>
                <Dialog.Root defaultOpen>
                    <Dialog.Popup><Dialog.Title>T</Dialog.Title></Dialog.Popup>
                </Dialog.Root>
            </OverlayHost>,
        );
        await act(() => {});
        const content = walk(container).find((n) => n.textContent() === 'content' && n.children.length === 0)!;
        expect(effectivePointerEvents(container, content)).toBe('auto');
    });

    it('dialog: backdrop, panel and close are hittable', async () => {
        const { container } = render(
            <OverlayHost>
                <Dialog.Root defaultOpen>
                    <Dialog.Popup>
                        <Dialog.Title>T</Dialog.Title>
                        <Dialog.Close>Close</Dialog.Close>
                    </Dialog.Popup>
                </Dialog.Root>
            </OverlayHost>,
        );
        await act(() => {});
        expect(byPart(container, 'dialog', 'close')).not.toBeNull();
        expectRouting(container);
    });

    it('popover: outside surface, popup and close are hittable', async () => {
        const { container } = render(
            <OverlayHost>
                <Popover.Root defaultOpen>
                    <Popover.Trigger><text>Open</text></Popover.Trigger>
                    <Popover.Popup>
                        <Popover.Title>T</Popover.Title>
                        <Popover.Close>x</Popover.Close>
                    </Popover.Popup>
                </Popover.Root>
            </OverlayHost>,
        );
        await act(() => {});
        expect(byPart(container, 'popover', 'close')).not.toBeNull();
        expectRouting(container);
    });

    it('select: the popup and its items are hittable', async () => {
        const { container } = render(
            <OverlayHost>
                <Select items={['Apple', 'Banana']} defaultOpen />
            </OverlayHost>,
        );
        await act(() => {});
        expect(byPart(container, 'select', 'item')).not.toBeNull();
        expectRouting(container);
    });

    it('toast: the viewport strip and its cards are hittable', async () => {
        const toaster = createToaster();
        const { container } = render(
            <OverlayHost>
                <Toast.Viewport toaster={toaster} />
            </OverlayHost>,
        );
        await act(() => { toaster.show({ title: 'Saved' }); });
        await act(() => {});
        expectRouting(container);
    });

    it('a dialog with a select open inside it: both roots opt in', async () => {
        const { container } = render(
            <OverlayHost>
                <Dialog.Root defaultOpen>
                    <Dialog.Popup>
                        <Select items={['Apple', 'Banana']} defaultOpen />
                    </Dialog.Popup>
                </Dialog.Root>
            </OverlayHost>,
        );
        await act(() => {});
        await act(() => {});
        expect(elementsOf(layerOf(container)).length).toBe(2);
        expectRouting(container);
    });
});

describe('fixedOutletRect — the outlet is not measured (#1181, #1182)', () => {
    it('sits at the root origin with its layout size', () => {
        expect(fixedOutletRect({ width: 402, height: 874 }, { width: 1, height: 1 })).toEqual(WINDOW);
    });

    it('falls back to the screen until the layer has laid out', () => {
        expect(fixedOutletRect(null, { width: 402, height: 874 })).toEqual(WINDOW);
        expect(fixedOutletRect({ width: 0, height: 0 }, { width: 402, height: 874 })).toEqual(WINDOW);
    });

    it('unknown when neither has a size', () => {
        expect(fixedOutletRect(null, { width: 0, height: 0 })).toBeNull();
    });

    it('a real host provides an origin at 0,0, so a measured safe frame yields insets', async () => {
        let read: (() => unknown) | null = null;
        const Probe = component(() => {
            read = useOverlayInsets();
            return () => <text>probe</text>;
        });
        render(
            <OverlayHost>
                <Probe />
            </OverlayHost>,
        );
        await act(() => {});
        // The frame's MT measurement never lands in tests, so the insets are
        // zero — but they must be computed against an outlet at the origin,
        // never a stale or shifted measurement.
        expect(read!()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    });
});
