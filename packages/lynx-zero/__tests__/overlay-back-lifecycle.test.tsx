/**
 * Overlay lifecycle (fix wave 9): the Android back button reaches the
 * dismiss stack (#1290), and an open overlay dies with its owner (#1291).
 *
 * The back button is modelled by `dispatchBackInterceptors()` — exactly what
 * lynx-navigation's hardware-back wiring calls before it pops a screen.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { component, signal } from '@sigx/lynx';
import { dispatchBackInterceptors } from '@sigx/lynx-core';
import { Combobox, Dialog, Drawer, Menu, OverlayHost, Popover, Select, clearDismissLayers, openLayerCount } from '../src/index';

afterEach(() => clearDismissLayers());

const byPart = (root: TestNode, scope: string, part: string): TestNode | null => {
    if (root.props['data-scope'] === scope && root.props['data-part'] === part) return root;
    for (const child of root.children) {
        const hit = byPart(child, scope, part);
        if (hit) return hit;
    }
    return null;
};

const FRUIT = ['Apple', 'Banana'];
const OPTIONS = [{ value: 'a', label: 'Apple' }, { value: 'b', label: 'Banana' }];

describe('Android back reaches the dismiss stack (#1290)', () => {
    it('holds no interceptor while nothing is open', () => {
        expect(dispatchBackInterceptors()).toBe(false);
    });

    it('closes an open dialog and consumes the press; the next press is free', async () => {
        const { container } = render(
            <OverlayHost>
                <Dialog.Root defaultOpen>
                    <Dialog.Popup><Dialog.Title>Confirm</Dialog.Title></Dialog.Popup>
                </Dialog.Root>
            </OverlayHost>,
        );
        await act(() => {});
        expect(byPart(container, 'dialog', 'popup')).not.toBeNull();
        let consumed = false;
        await act(() => { consumed = dispatchBackInterceptors(); });
        await act(() => {});
        expect(consumed).toBe(true);
        expect(byPart(container, 'dialog', 'popup')).toBeNull();
        // Nothing open: the press would navigate.
        expect(dispatchBackInterceptors()).toBe(false);
    });

    it('a non-dismissible dialog consumes the press without closing', async () => {
        const { container } = render(
            <OverlayHost>
                <Dialog.Root defaultOpen dismissible={false}>
                    <Dialog.Popup><Dialog.Title>Required</Dialog.Title></Dialog.Popup>
                </Dialog.Root>
            </OverlayHost>,
        );
        await act(() => {});
        let consumed = false;
        await act(() => { consumed = dispatchBackInterceptors(); });
        await act(() => {});
        expect(consumed).toBe(true);
        expect(byPart(container, 'dialog', 'popup')).not.toBeNull();
    });

    it('closes a drawer with the escape reason', async () => {
        const reasons: string[] = [];
        const { container } = render(
            <OverlayHost>
                <Drawer.Root defaultOpen onClose={(d: { reason: string }) => reasons.push(d.reason)}>
                    <Drawer.Panel><Drawer.Title>Nav</Drawer.Title></Drawer.Panel>
                </Drawer.Root>
            </OverlayHost>,
        );
        await act(() => {});
        expect(byPart(container, 'drawer', 'panel')).not.toBeNull();
        await act(() => { dispatchBackInterceptors(); });
        await act(() => {});
        expect(byPart(container, 'drawer', 'panel')).toBeNull();
        expect(reasons).toEqual(['escape']);
    });

    it('closes a menu\'s open submenu first, then the menu', async () => {
        const { container } = render(
            <OverlayHost>
                <Menu.Root defaultOpen>
                    <Menu.Trigger><text>File</text></Menu.Trigger>
                    <Menu.Popup>
                        <Menu.Sub defaultOpen>
                            <Menu.SubTrigger><text>Share</text></Menu.SubTrigger>
                            <Menu.SubPopup>
                                <Menu.Item value="email"><text>Email</text></Menu.Item>
                            </Menu.SubPopup>
                        </Menu.Sub>
                    </Menu.Popup>
                </Menu.Root>
            </OverlayHost>,
        );
        await act(() => {});
        await act(() => {});
        expect(openLayerCount()).toBe(2);
        await act(() => { dispatchBackInterceptors(); });
        await act(() => {});
        expect(openLayerCount()).toBe(1);
        expect(byPart(container, 'menu', 'popup')).not.toBeNull();
        await act(() => { dispatchBackInterceptors(); });
        await act(() => {});
        expect(openLayerCount()).toBe(0);
        expect(byPart(container, 'menu', 'popup')).toBeNull();
        expect(dispatchBackInterceptors()).toBe(false);
    });

    it('closes an open popover, select and combobox', async () => {
        const { container } = render(
            <OverlayHost>
                <Popover.Root defaultOpen>
                    <Popover.Trigger><text>More</text></Popover.Trigger>
                    <Popover.Popup><Popover.Title>Info</Popover.Title></Popover.Popup>
                </Popover.Root>
                <Select.Root items={OPTIONS} itemValue={(o: { value: string }) => o.value} defaultOpen placeholder="Pick" />
                <Combobox items={FRUIT} defaultOpen placeholder="Fruit" />
            </OverlayHost>,
        );
        await act(() => {});
        await act(() => {});
        expect(openLayerCount()).toBe(3);
        for (let i = 0; i < 3; i++) {
            let consumed = false;
            await act(() => { consumed = dispatchBackInterceptors(); });
            await act(() => {});
            expect(consumed).toBe(true);
        }
        expect(openLayerCount()).toBe(0);
        expect(byPart(container, 'popover', 'popup')).toBeNull();
        expect(byPart(container, 'combobox', 'popup')).toBeNull();
        expect(dispatchBackInterceptors()).toBe(false);
    });
});

describe('an open overlay dies with its owner (#1291)', () => {
    it('a screen unmounting with a dialog and a drawer open leaves nothing behind', async () => {
        const state = signal({ screen: true });
        const Screen = component(() => () => (
            <view>
                <Dialog.Root defaultOpen>
                    <Dialog.Popup><text>dialog-body</text></Dialog.Popup>
                </Dialog.Root>
                <Drawer.Root defaultOpen>
                    <Drawer.Panel><text>drawer-body</text></Drawer.Panel>
                </Drawer.Root>
            </view>
        ));
        const Gate = component(() => () => (state.screen ? <Screen /> : <text>home</text>));
        const { container } = render(
            <OverlayHost>
                <Gate />
            </OverlayHost>,
        );
        await act(() => {});
        expect(container.textContent()).toContain('dialog-body');
        expect(container.textContent()).toContain('drawer-body');
        expect(openLayerCount()).toBe(2);

        await act(() => { state.screen = false; });
        await act(() => {});
        expect(container.textContent()).not.toContain('dialog-body');
        expect(container.textContent()).not.toContain('drawer-body');
        expect(container.textContent()).toContain('home');
        // The layers left too, so the next back press navigates.
        expect(openLayerCount()).toBe(0);
        expect(dispatchBackInterceptors()).toBe(false);
    });
});
