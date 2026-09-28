/**
 * Wave 5, overlays (W5A #1277): Drawer and Tooltip on zero's drawer and
 * tooltip anatomy — conformance while open, the close reasons, the edge
 * geometry (pure), the long-press tooltip and its arrow.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { signal } from '@sigx/lynx';
import type { DrawerCloseDetail } from '../src/index';
import { Drawer, OverlayHost, TOOLTIP_CLOSE_DELAY, Tooltip, clearDismissLayers, dismissTopLayer, openLayerCount } from '../src/index';
import { ForceStates, expectAnatomy, expectClassGrammar } from '../src/testing/index';
import { drawerLayout } from '../src/components/drawer/Drawer';
import { arrowStyle } from '../src/components/tooltip/Tooltip';
import { computeArrowOffset } from '../src/behaviors/position';

afterEach(() => clearDismissLayers());

const allParts = (root: TestNode, scope: string, part: string): TestNode[] => {
    const out: TestNode[] = [];
    const walk = (n: TestNode): void => {
        if (n.props['data-scope'] === scope && n.props['data-part'] === part) out.push(n);
        for (const child of n.children) walk(child);
    };
    walk(root);
    return out;
};
const byPart = (root: TestNode, scope: string, part: string): TestNode | null => allParts(root, scope, part)[0] ?? null;

const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

describe('Drawer', () => {
    const Probe = (p: { onClose?: (d: DrawerCloseDetail) => void; placement?: 'start' | 'end' | 'top' | 'bottom' }) => (
        <OverlayHost>
            <Drawer.Root color="primary" size="lg" placement={p.placement} onClose={p.onClose}>
                <Drawer.Trigger><text>Menu</text></Drawer.Trigger>
                <Drawer.Panel>
                    <Drawer.Title>Navigation</Drawer.Title>
                    <text>Links</text>
                    <Drawer.Close value="done"><text>Close</text></Drawer.Close>
                </Drawer.Panel>
            </Drawer.Root>
        </OverlayHost>
    );

    it('opens through the trigger and conforms while open', async () => {
        const { container } = render(<Probe />);
        expect(byPart(container, 'drawer', 'panel')).toBeNull();
        const trigger = byPart(container, 'drawer', 'trigger')!;
        expect(trigger._class).toContain('zx-s-closed');
        expect(trigger.props['accessibility-status']).toBe('collapsed');
        await act(() => fireEvent.tap(trigger as never));
        await act(() => {});
        const panel = byPart(container, 'drawer', 'panel')!;
        expect(panel).not.toBeNull();
        expect(trigger._class).toContain('zx-s-open');
        expect(trigger.props['accessibility-status']).toBe('expanded');
        // The sheet regime + the edge, as data attrs AND classes.
        expect(panel.props['data-l-dock']).toBe('sheet');
        expect(panel._class).toContain('zx-l-dock-sheet');
        expect(panel.props['data-placement']).toBe('start');
        expect(panel._class).toContain('zx-p-start');
        expect(panel._class).toContain('zx-s-open');
        // Axes cross the portal into slot-rendered parts.
        expect(byPart(container, 'drawer', 'title')!._class).toContain('zx-a-color-primary');
        expect(byPart(container, 'drawer', 'close')!._class).toContain('zx-a-size-lg');
        // The backdrop is a REAL part holding the panel, opted into touches.
        const backdrop = byPart(container, 'drawer', 'backdrop')!;
        expect(backdrop._style['pointer-events'] ?? backdrop._style['pointerEvents']).toBe('auto');
        expectAnatomy(container as never, anatomies.drawer);
        expectClassGrammar(container as never, anatomies.drawer);
        expect(openLayerCount()).toBe(1);
    });

    it('reports every close with its reason: close (+value), backdrop, escape, programmatic', async () => {
        const closes: DrawerCloseDetail[] = [];
        const open = signal({ value: false });
        const { container } = render(
            <OverlayHost>
                <Drawer.Root model={() => open.value} onClose={(d) => closes.push(d)}>
                    <Drawer.Trigger><text>Menu</text></Drawer.Trigger>
                    <Drawer.Panel>
                        <Drawer.Close value="done"><text>Close</text></Drawer.Close>
                    </Drawer.Panel>
                </Drawer.Root>
            </OverlayHost>,
        );
        const trigger = byPart(container, 'drawer', 'trigger')!;
        const reopen = async (): Promise<void> => {
            await act(() => fireEvent.tap(trigger as never));
            await act(() => {});
            expect(byPart(container, 'drawer', 'panel')).not.toBeNull();
        };

        await reopen();
        await act(() => fireEvent.tap(byPart(container, 'drawer', 'close') as never));
        await act(() => {});
        expect(byPart(container, 'drawer', 'panel')).toBeNull();

        await reopen();
        await act(() => fireEvent.tap(byPart(container, 'drawer', 'backdrop') as never));
        await act(() => {});
        expect(byPart(container, 'drawer', 'panel')).toBeNull();

        await reopen();
        expect(dismissTopLayer()).toBe(true);
        await act(() => {});
        expect(byPart(container, 'drawer', 'panel')).toBeNull();

        await reopen();
        await act(() => {
            open.value = false;
        });
        await act(() => {});
        expect(byPart(container, 'drawer', 'panel')).toBeNull();

        expect(closes).toEqual([
            { reason: 'close', value: 'done' },
            { reason: 'backdrop' },
            { reason: 'escape' },
            { reason: 'programmatic' },
        ]);
        expect(openLayerCount()).toBe(0);
    });

    it('a panel tap never reaches the backdrop; dismissible={false} holds', async () => {
        const { container } = render(
            <OverlayHost>
                <Drawer.Root defaultOpen dismissible={false}>
                    <Drawer.Panel><Drawer.Title>Held</Drawer.Title></Drawer.Panel>
                </Drawer.Root>
            </OverlayHost>,
        );
        await act(() => {});
        const panel = byPart(container, 'drawer', 'panel')!;
        expect(typeof panel.props['catchtap']).toBe('function');
        await act(() => fireEvent.tap(byPart(container, 'drawer', 'backdrop') as never));
        await act(() => {});
        expect(byPart(container, 'drawer', 'panel')).not.toBeNull();
        // The layer still consumes a back-button dismissal — and stays up.
        expect(dismissTopLayer()).toBe(true);
        await act(() => {});
        expect(byPart(container, 'drawer', 'panel')).not.toBeNull();
    });

    it('stamps every placement', async () => {
        for (const placement of ['start', 'end', 'top', 'bottom'] as const) {
            const { container } = render(
                <OverlayHost>
                    <Drawer.Root defaultOpen placement={placement}>
                        <Drawer.Panel><Drawer.Title>Edge</Drawer.Title></Drawer.Panel>
                    </Drawer.Root>
                </OverlayHost>,
            );
            await act(() => {});
            const panel = byPart(container, 'drawer', 'panel')!;
            expect(panel._class, placement).toContain(`zx-p-${placement}`);
            expectAnatomy(container as never, anatomies.drawer);
            expectClassGrammar(container as never, anatomies.drawer);
            clearDismissLayers();
        }
    });

    it('forced states land on trigger and close; disabled refuses', async () => {
        const { container } = render(
            <OverlayHost>
                <ForceStates flags={{ pressed: true, 'focus-visible': true }}>
                    <Drawer.Root defaultOpen>
                        <Drawer.Trigger><text>Menu</text></Drawer.Trigger>
                        <Drawer.Panel>
                            <Drawer.Close disabled><text>Close</text></Drawer.Close>
                        </Drawer.Panel>
                    </Drawer.Root>
                </ForceStates>
            </OverlayHost>,
        );
        await act(() => {});
        const trigger = byPart(container, 'drawer', 'trigger')!;
        const close = byPart(container, 'drawer', 'close')!;
        for (const node of [trigger, close]) {
            expect(node._class).toContain('zx-f-pressed');
            expect(node._class).toContain('zx-f-focus-visible');
        }
        expect(close._class).toContain('zx-f-disabled');
        // The panel declares neither flag.
        expect(byPart(container, 'drawer', 'panel')!._class).not.toContain('zx-f-');
        expectAnatomy(container as never, anatomies.drawer);
        expectClassGrammar(container as never, anatomies.drawer);
        await act(() => fireEvent.tap(close as never));
        await act(() => {});
        expect(byPart(container, 'drawer', 'panel')).not.toBeNull();
    });

    it('a disabled trigger does not open', async () => {
        const { container } = render(
            <OverlayHost>
                <Drawer.Root>
                    <Drawer.Trigger disabled><text>Menu</text></Drawer.Trigger>
                    <Drawer.Panel><Drawer.Title>Never</Drawer.Title></Drawer.Panel>
                </Drawer.Root>
            </OverlayHost>,
        );
        await act(() => fireEvent.tap(byPart(container, 'drawer', 'trigger') as never));
        await act(() => {});
        expect(byPart(container, 'drawer', 'panel')).toBeNull();
    });

    it('a visually-hidden title stays in the tree, out of paint', async () => {
        const { container } = render(
            <OverlayHost>
                <Drawer.Root defaultOpen>
                    <Drawer.Panel><Drawer.Title visuallyHidden>Filters</Drawer.Title></Drawer.Panel>
                </Drawer.Root>
            </OverlayHost>,
        );
        await act(() => {});
        const title = byPart(container, 'drawer', 'title')!;
        expect(title.props['data-visually-hidden']).toBe('');
        expect(title._style['opacity']).toBe('0');
        expect(title.props['accessibility-trait']).toBe('header');
        expectAnatomy(container as never, anatomies.drawer);
    });

    it('modal={false} renders the panel in place, inline, with no backdrop or layer', async () => {
        const { container } = render(
            <OverlayHost>
                <Drawer.Root modal={false} defaultOpen>
                    <Drawer.Trigger><text>Filters</text></Drawer.Trigger>
                    <Drawer.Panel><Drawer.Title>Filters</Drawer.Title></Drawer.Panel>
                </Drawer.Root>
            </OverlayHost>,
        );
        await act(() => {});
        const panel = byPart(container, 'drawer', 'panel')!;
        expect(panel.props['data-l-dock']).toBe('inline');
        expect(panel._class).toContain('zx-l-dock-inline');
        expect(byPart(container, 'drawer', 'backdrop')).toBeNull();
        expect(openLayerCount()).toBe(0);
        expectAnatomy(container as never, anatomies.drawer);
        expectClassGrammar(container as never, anatomies.drawer);
        await act(() => fireEvent.tap(byPart(container, 'drawer', 'trigger') as never));
        await act(() => {});
        expect(byPart(container, 'drawer', 'panel')).toBeNull();
    });
});

describe('drawerLayout (pure)', () => {
    const insets = { top: 62, right: 0, bottom: 34, left: 0 };

    it('puts a side panel on its edge, full height, 85% wide under the skin cap', () => {
        const start = drawerLayout('start', insets, 874, 0);
        expect(start.backdrop).toMatchObject({ display: 'flex', flexDirection: 'row', alignItems: 'stretch', justifyContent: 'flex-start' });
        expect(start.panel.width).toBe('85%');
        expect(start.panel.maxWidth).toBeUndefined();
        // In flow, never the skin's `fixed`; `auto` over its `100dvh`.
        expect(start.panel).toMatchObject({ position: 'relative', height: 'auto', maxHeight: 'none' });
        const end = drawerLayout('end', insets, 874, 0);
        expect(end.backdrop.justifyContent).toBe('flex-end');
    });

    it('caps a block-edge sheet at 85% of the outlet (the recipe’s 85dvh), full width', () => {
        const bottom = drawerLayout('bottom', insets, 874, 0);
        expect(bottom.backdrop).toMatchObject({ flexDirection: 'column', justifyContent: 'flex-end' });
        expect(bottom.panel.maxHeight).toBe(`${Math.round(0.85 * 874)}px`);
        expect(bottom.panel.width).toBe('100%');
        const top = drawerLayout('top', insets, 874, 0);
        expect(top.backdrop.justifyContent).toBe('flex-start');
        // Unmeasured outlet: a percentage of the backdrop instead.
        expect(drawerLayout('top', insets, 0, 0).panel.maxHeight).toBe('85%');
    });

    it('measure: px caps (never past the window), full fills', () => {
        expect(drawerLayout('start', NO_INSETS, 800, 0, 280).panel).toMatchObject({ width: '280px', maxWidth: '100%' });
        expect(drawerLayout('end', NO_INSETS, 800, 0, 'full').panel).toMatchObject({ width: '100%', maxWidth: 'none' });
        expect(drawerLayout('bottom', NO_INSETS, 800, 0, 300).panel).toMatchObject({ width: '300px', alignSelf: 'center' });
    });

    it('pads the content by the safe frame on the edges it touches, and by the keyboard', () => {
        const frame = { top: 62, right: 10, bottom: 34, left: 12 };
        expect(drawerLayout('start', frame, 874, 0).content).toEqual({ paddingTop: '62px', paddingRight: '0px', paddingBottom: '34px', paddingLeft: '12px' });
        expect(drawerLayout('end', frame, 874, 0).content).toEqual({ paddingTop: '62px', paddingRight: '10px', paddingBottom: '34px', paddingLeft: '0px' });
        expect(drawerLayout('top', frame, 874, 300).content).toEqual({ paddingTop: '62px', paddingRight: '10px', paddingBottom: '0px', paddingLeft: '12px' });
        // The keyboard's overlap wins over the safe frame when higher.
        expect(drawerLayout('bottom', frame, 874, 300).content.paddingBottom).toBe('300px');
        expect(drawerLayout('bottom', frame, 874, 10).content.paddingBottom).toBe('34px');
    });
});

describe('Tooltip', () => {
    const Probe = (p: { closeDelay?: number; disabled?: boolean }) => (
        <OverlayHost>
            <Tooltip.Root color="accent" closeDelay={p.closeDelay}>
                <Tooltip.Trigger label="Save" disabled={p.disabled}><text>Save</text></Tooltip.Trigger>
                <Tooltip.Popup>
                    <text>Save the document</text>
                    <Tooltip.Arrow />
                </Tooltip.Popup>
            </Tooltip.Root>
        </OverlayHost>
    );

    // Real timers with short delays: fake timers and the renderer's act()
    // starve each other (the Toast lesson).
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

    it('opens on a long press, conforms, and closes closeDelay after release', async () => {
        expect(TOOLTIP_CLOSE_DELAY).toBe(1500);
        const { container } = render(<Probe closeDelay={60} />);
        const trigger = byPart(container, 'tooltip', 'trigger')!;
        expect(trigger._class).toContain('zx-s-closed');
        expect(trigger.props['accessibility-label']).toBe('Save');
        // A tap is the content's, not the tooltip's.
        await act(() => fireEvent.tap(trigger as never));
        await act(() => {});
        expect(byPart(container, 'tooltip', 'popup')).toBeNull();

        await act(() => fireEvent.longPress(trigger as never));
        await act(() => {});
        const popup = byPart(container, 'tooltip', 'popup')!;
        expect(popup).not.toBeNull();
        expect(trigger._class).toContain('zx-s-open');
        expect(popup.props['data-placement']).toBe('top');
        expect(popup._class).toContain('zx-p-top');
        expect(popup._style['overflow']).toBe('visible');
        const arrow = byPart(container, 'tooltip', 'arrow')!;
        expect(arrow._class).toContain('zx-a-color-accent');
        expectAnatomy(container as never, anatomies.tooltip);
        expectClassGrammar(container as never, anatomies.tooltip);
        // Never a dismiss layer: a back press is not the tooltip's.
        expect(openLayerCount()).toBe(0);

        await act(() => fireEvent.touchEnd(trigger as never));
        await act(() => {});
        expect(byPart(container, 'tooltip', 'popup')).not.toBeNull();
        await act(() => sleep(100));
        await act(() => {});
        expect(byPart(container, 'tooltip', 'popup')).toBeNull();
        expect(trigger._class).toContain('zx-s-closed');
    });

    it('a cancelled touch closes too; a tap on the popup closes it at once', async () => {
        const { container } = render(<Probe closeDelay={20} />);
        const trigger = byPart(container, 'tooltip', 'trigger')!;
        await act(() => fireEvent.longPress(trigger as never));
        await act(() => fireEvent.touchCancel(trigger as never));
        await act(() => sleep(60));
        await act(() => {});
        expect(byPart(container, 'tooltip', 'popup')).toBeNull();

        await act(() => fireEvent.longPress(trigger as never));
        await act(() => {});
        await act(() => fireEvent.tap(byPart(container, 'tooltip', 'popup') as never));
        await act(() => {});
        expect(byPart(container, 'tooltip', 'popup')).toBeNull();
    });

    it('a disabled trigger never opens', async () => {
        const { container } = render(<Probe disabled />);
        const trigger = byPart(container, 'tooltip', 'trigger')!;
        expect(trigger._class).toContain('zx-f-disabled');
        await act(() => fireEvent.longPress(trigger as never));
        await act(() => {});
        expect(byPart(container, 'tooltip', 'popup')).toBeNull();
    });

    it('an app-opened tooltip (defaultOpen) does not time out on a stray release', async () => {
        const { container } = render(
            <OverlayHost>
                <Tooltip.Root defaultOpen placement="bottom" closeDelay={10}>
                    <Tooltip.Trigger><text>i</text></Tooltip.Trigger>
                    <Tooltip.Popup><text>Pinned</text><Tooltip.Arrow /></Tooltip.Popup>
                </Tooltip.Root>
            </OverlayHost>,
        );
        await act(() => {});
        await act(() => fireEvent.touchEnd(byPart(container, 'tooltip', 'trigger') as never));
        await act(() => sleep(50));
        const popup = byPart(container, 'tooltip', 'popup')!;
        expect(popup).not.toBeNull();
        expect(popup._class).toContain('zx-p-bottom');
        expectAnatomy(container as never, anatomies.tooltip);
        expectClassGrammar(container as never, anatomies.tooltip);
    });
});

describe('tooltip arrow geometry (pure)', () => {
    const anchor = { top: 100, left: 100, right: 140, bottom: 120, width: 40, height: 20 };

    it('points at the anchor centre along the popup edge, clamped inside it', () => {
        // A 100-wide popup above the anchor, centred: the arrow at its middle.
        expect(computeArrowOffset(anchor, { width: 100, height: 30 }, { top: 62, left: 70, placement: 'top' })).toEqual({ x: 50 });
        // Clamped against a screen edge: the popup sits right of centre.
        expect(computeArrowOffset(anchor, { width: 100, height: 30 }, { top: 62, left: 115, placement: 'top' })).toEqual({ x: 8 });
        // Beside: the offset is on y.
        expect(computeArrowOffset(anchor, { width: 60, height: 40 }, { top: 90, left: 148, placement: 'right' })).toEqual({ y: 20 });
    });

    it('sits half outside the edge facing the anchor, hidden until measured', () => {
        expect(arrowStyle('top', { x: 50 })).toMatchObject({ position: 'absolute', bottom: '-4px', left: '46px', transform: 'rotate(45deg)' });
        expect(arrowStyle('bottom-start', { x: 20 })).toMatchObject({ top: '-4px', left: '16px' });
        expect(arrowStyle('left', { y: 20 })).toMatchObject({ right: '-4px', top: '16px' });
        expect(arrowStyle('right', { y: 20 })).toMatchObject({ left: '-4px', top: '16px' });
        expect(arrowStyle('top', null).opacity).toBe(0);
    });
});
