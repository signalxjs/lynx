/**
 * Overlays belong to their screen (fix wave 10).
 *
 * #1308: a navigator keeps a covered screen mounted, and the outlet paints
 * above the whole page. A covered screen's open overlays must stop painting
 * and stop claiming back, and come back when the screen is uncovered.
 * Screen activity is modelled with `provideScreenActive` — exactly what
 * lynx-navigation's `<EntryScope>` provides per screen.
 *
 * #1312: iOS's back is the edge swipe, and an open layer sits above the
 * navigator's edge strip. The outlet carries its own strip that offers the
 * swipe to the back interceptors.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, touch } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import type { Define } from '@sigx/lynx';
import { component, onMounted, provideScreenActive, signal } from '@sigx/lynx';
import { dispatchBackInterceptors, hasBackInterceptors } from '@sigx/lynx-core';
import { Dialog, Drawer, OverlayHost, Popover, Toast, clearDismissLayers, createToaster, hasActiveDismissLayer } from '../src/index';
import { setEdgeBackEnabledForTest } from '../src/overlay/edge-back';

let restoreEdge: (() => void) | null = null;
afterEach(() => {
    clearDismissLayers();
    restoreEdge?.();
    restoreEdge = null;
});

const walk = (node: TestNode, out: TestNode[] = []): TestNode[] => {
    out.push(node);
    for (const child of node.children) walk(child, out);
    return out;
};

const byPart = (root: TestNode, scope: string, part: string): TestNode | null =>
    walk(root).find((n) => n.props['data-scope'] === scope && n.props['data-part'] === part) ?? null;

const isLayer = (n: TestNode): boolean => n._style?.position === 'fixed' && n._style?.width === 0;
const layerOf = (container: TestNode): TestNode => walk(container).find(isLayer)!;

/** Whether `node` paints: neither it nor an ancestor is `display: none`. */
const paints = (root: TestNode, node: TestNode): boolean => {
    const path: TestNode[] = [];
    const find = (n: TestNode): boolean => {
        path.push(n);
        if (n === node) return true;
        for (const c of n.children) if (find(c)) return true;
        path.pop();
        return false;
    };
    if (!find(root)) throw new Error('node not in tree');
    return path.every((n) => n._style?.display !== 'none');
};

const edgeStrip = (container: TestNode): TestNode | null => {
    const layer = layerOf(container);
    return layer.children.find((n) => n._style?.width === '20px' && n._handlers?.has('bindtouchend')) ?? null;
};

const swipe = async (node: TestNode, dx: number, dy = 0): Promise<void> => {
    await act(() => fireEvent.touchStart(node as never, { touches: [touch(2, 300)] }));
    await act(() => fireEvent.touchMove(node as never, { touches: [touch(2 + dx / 2, 300 + dy / 2)] }));
    await act(() => fireEvent.touchEnd(node as never, { changedTouches: [touch(2 + dx, 300 + dy)] }));
    await act(() => {});
};

/** A screen whose activity the test drives. */
type ScreenProps = Define.Prop<'state', { active: boolean }, true> & Define.Slot<'default'>;
const Screen = component<ScreenProps>(({ props, slots }) => {
    provideScreenActive(() => props.state.active);
    return () => <view>{slots.default?.()}</view>;
});

let bodyMounts = 0;
const CountedBody = component(() => {
    onMounted(() => {
        bodyMounts++;
    });
    return () => <text>body</text>;
});

describe('a covered screen\'s overlays stand down (#1308)', () => {
    it('takes the covered screen\'s dialog out of the outlet and brings it back when uncovered', async () => {
        bodyMounts = 0;
        const screen = signal({ active: true });
        const { container } = render(
            <OverlayHost>
                <Screen state={screen}>
                    <Dialog.Root defaultOpen>
                        <Dialog.Popup><CountedBody /></Dialog.Popup>
                    </Dialog.Root>
                </Screen>
            </OverlayHost>,
        );
        await act(() => {});
        expect(byPart(container, 'dialog', 'popup')).not.toBeNull();
        expect(bodyMounts).toBe(1);

        await act(() => { screen.active = false; });
        await act(() => {});
        // Nothing of it paints over the screen on top, and the layer itself
        // is display:none with no active entry.
        expect(byPart(container, 'dialog', 'popup')).toBeNull();
        expect(byPart(container, 'dialog', 'backdrop')).toBeNull();
        expect(layerOf(container)._style.display).toBe('none');

        // Uncovered: the dialog is still open, so it renders again (as on a
        // fresh open: the portal content remounts).
        await act(() => { screen.active = true; });
        await act(() => {});
        const popup = byPart(container, 'dialog', 'popup');
        expect(popup).not.toBeNull();
        expect(paints(container, popup!)).toBe(true);
        expect(layerOf(container)._style.display).toBe('flex');
        expect(bodyMounts).toBe(2);
    });

    it('a covered screen\'s layer does not claim back; the screen on top\'s does', async () => {
        const under = signal({ active: false });
        const top = signal({ active: true });
        expect(hasBackInterceptors()).toBe(false);
        const { container } = render(
            <OverlayHost>
                <Screen state={under}>
                    <Dialog.Root defaultOpen dismissible={false}>
                        <Dialog.Popup><text>under</text></Dialog.Popup>
                    </Dialog.Root>
                </Screen>
                <Screen state={top}>
                    <Popover.Root defaultOpen>
                        <Popover.Trigger><text>More</text></Popover.Trigger>
                        <Popover.Popup><Popover.Title>Info</Popover.Title></Popover.Popup>
                    </Popover.Root>
                </Screen>
            </OverlayHost>,
        );
        await act(() => {});
        await act(() => {});
        // The press closes the top screen's popover...
        let consumed = false;
        await act(() => { consumed = dispatchBackInterceptors(); });
        await act(() => {});
        expect(consumed).toBe(true);
        expect(byPart(container, 'popover', 'popup')).toBeNull();
        // ...and then the covered screen's non-dismissible dialog does NOT
        // swallow the next one: back navigates (#1308's stuck user).
        expect(hasActiveDismissLayer()).toBe(false);
        expect(hasBackInterceptors()).toBe(false);
        expect(dispatchBackInterceptors()).toBe(false);
        // The covered dialog was left alone: uncovered, it is still open.
        await act(() => { under.active = true; });
        await act(() => {});
        expect(byPart(container, 'dialog', 'popup')).not.toBeNull();
    });

    it('covering and uncovering releases and re-takes the back interceptor', async () => {
        const screen = signal({ active: true });
        render(
            <OverlayHost>
                <Screen state={screen}>
                    <Drawer.Root defaultOpen>
                        <Drawer.Panel><Drawer.Title>Nav</Drawer.Title></Drawer.Panel>
                    </Drawer.Root>
                </Screen>
            </OverlayHost>,
        );
        await act(() => {});
        expect(hasBackInterceptors()).toBe(true);
        await act(() => { screen.active = false; });
        await act(() => {});
        expect(hasBackInterceptors()).toBe(false);
        expect(dispatchBackInterceptors()).toBe(false);
        await act(() => { screen.active = true; });
        await act(() => {});
        expect(hasBackInterceptors()).toBe(true);
    });

    it('a mixed outlet (one app-level host) hides only the covered screen\'s entry', async () => {
        const under = signal({ active: true });
        const top = signal({ active: true });
        const { container } = render(
            <OverlayHost>
                <Screen state={under}>
                    <Dialog.Root defaultOpen>
                        <Dialog.Popup><text>under</text></Dialog.Popup>
                    </Dialog.Root>
                </Screen>
                <Screen state={top}>
                    <Drawer.Root defaultOpen>
                        <Drawer.Panel><Drawer.Title>Nav</Drawer.Title></Drawer.Panel>
                    </Drawer.Root>
                </Screen>
            </OverlayHost>,
        );
        await act(() => {});
        await act(() => { under.active = false; });
        await act(() => {});
        expect(byPart(container, 'dialog', 'popup')).toBeNull();
        expect(paints(container, byPart(container, 'drawer', 'panel')!)).toBe(true);
    });

    it('outside any screen, every overlay is active (no navigator)', async () => {
        const { container } = render(
            <OverlayHost>
                <Dialog.Root defaultOpen>
                    <Dialog.Popup><text>plain</text></Dialog.Popup>
                </Dialog.Root>
            </OverlayHost>,
        );
        await act(() => {});
        expect(paints(container, byPart(container, 'dialog', 'popup')!)).toBe(true);
        expect(hasActiveDismissLayer()).toBe(true);
    });
});

describe('the iOS edge swipe is a back press while a layer is open (#1312)', () => {
    it('closes a dismissible dialog, and the strip goes with it', async () => {
        restoreEdge = setEdgeBackEnabledForTest(true);
        const { container } = render(
            <OverlayHost>
                <Dialog.Root defaultOpen>
                    <Dialog.Popup><text>body</text></Dialog.Popup>
                </Dialog.Root>
            </OverlayHost>,
        );
        await act(() => {});
        await act(() => {});
        const strip = edgeStrip(container);
        expect(strip).not.toBeNull();
        // The strip is last in the layer: it paints (and hit-tests) above the layers.
        const layer = layerOf(container);
        const elements = layer.children.filter((n) => !n.type.startsWith('#'));
        expect(elements[elements.length - 1]).toBe(strip);
        expect(strip!._style.pointerEvents).toBe('auto');
        await swipe(strip!, 200);
        expect(byPart(container, 'dialog', 'popup')).toBeNull();
        expect(edgeStrip(container)).toBeNull();
    });

    it('closes a dismissible drawer with the escape reason', async () => {
        restoreEdge = setEdgeBackEnabledForTest(true);
        const reasons: string[] = [];
        const { container } = render(
            <OverlayHost>
                <Drawer.Root defaultOpen onClose={(d: { reason: string }) => reasons.push(d.reason)}>
                    <Drawer.Panel><Drawer.Title>Nav</Drawer.Title></Drawer.Panel>
                </Drawer.Root>
            </OverlayHost>,
        );
        await act(() => {});
        await act(() => {});
        await swipe(edgeStrip(container)!, 200);
        expect(reasons).toEqual(['escape']);
        expect(byPart(container, 'drawer', 'panel')).toBeNull();
    });

    it('a non-dismissible dialog keeps the swipe without closing (like Android back)', async () => {
        restoreEdge = setEdgeBackEnabledForTest(true);
        const { container } = render(
            <OverlayHost>
                <Dialog.Root defaultOpen dismissible={false}>
                    <Dialog.Popup><text>required</text></Dialog.Popup>
                </Dialog.Root>
            </OverlayHost>,
        );
        await act(() => {});
        await act(() => {});
        await swipe(edgeStrip(container)!, 200);
        expect(byPart(container, 'dialog', 'popup')).not.toBeNull();
    });

    it('a short, vertical or leftward drag is not a back swipe', async () => {
        restoreEdge = setEdgeBackEnabledForTest(true);
        const { container } = render(
            <OverlayHost>
                <Dialog.Root defaultOpen>
                    <Dialog.Popup><text>body</text></Dialog.Popup>
                </Dialog.Root>
            </OverlayHost>,
        );
        await act(() => {});
        await act(() => {});
        const strip = edgeStrip(container)!;
        await swipe(strip, 20);
        await swipe(strip, 60, 200);
        await swipe(strip, -60);
        expect(byPart(container, 'dialog', 'popup')).not.toBeNull();
    });

    it('no strip for a toast alone, for a covered screen, or off iOS', async () => {
        restoreEdge = setEdgeBackEnabledForTest(true);
        const toaster = createToaster();
        const screen = signal({ active: true });
        const { container } = render(
            <OverlayHost>
                <Toast.Viewport toaster={toaster} />
                <Screen state={screen}>
                    <Dialog.Root defaultOpen>
                        <Dialog.Popup><text>body</text></Dialog.Popup>
                    </Dialog.Root>
                </Screen>
            </OverlayHost>,
        );
        await act(() => { toaster.show({ title: 'Saved' }); });
        await act(() => {});
        expect(edgeStrip(container)).not.toBeNull();
        // Covered: the toast still shows, but the edge belongs to the navigator.
        await act(() => { screen.active = false; });
        await act(() => {});
        expect(edgeStrip(container)).toBeNull();
        await act(() => { screen.active = true; });
        await act(() => {});
        expect(edgeStrip(container)).not.toBeNull();
        restoreEdge();
        restoreEdge = setEdgeBackEnabledForTest(false);
        await act(() => { screen.active = false; });
        await act(() => { screen.active = true; });
        await act(() => {});
        expect(edgeStrip(container)).toBeNull();
    });
});
