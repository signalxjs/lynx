/**
 * #1273 (epic #1140, fix wave 8): sibling submenus are mutually exclusive.
 * The web's menu keeps one sub-chain open per level, so opening a submenu
 * closes a sibling open beside it. On lynx each `Menu.Sub` held its own open
 * state, so tapping `Export` while `Share` was open stacked two sub-popups.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { signal } from '@sigx/lynx';
import { act, fireEvent, render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { Menu, OverlayHost, clearDismissLayers, dismissTopLayer } from '../src/index';
import { expectAnatomy, expectClassGrammar } from '../src/testing/index';

afterEach(() => clearDismissLayers());

const allParts = (root: TestNode, part: string): TestNode[] => {
    const out: TestNode[] = [];
    const walk = (n: TestNode): void => {
        if (n.props['data-scope'] === 'menu' && n.props['data-part'] === part) out.push(n);
        for (const child of n.children) walk(child);
    };
    walk(root);
    return out;
};
const MENU_PORTALED = { portaled: ['popup', 'sub-popup'] } as const;

/** The sub-popups on screen, each named by the text of its rows. */
const openSubs = (root: TestNode): string[] => allParts(root, 'sub-popup').map((p) => p.textContent());
const subTrigger = (root: TestNode, label: string): TestNode =>
    allParts(root, 'sub-trigger').find((t) => t.textContent().includes(label))!;

const settle = async (): Promise<void> => {
    await act(() => {});
    await act(() => {});
};

interface Options {
    shareOpen?: boolean;
    exportOpen?: boolean;
    shareModel?: { open: boolean };
    log?: string[];
}

function renderMenu(options: Options = {}) {
    const log = options.log ?? [];
    const shareModel = options.shareModel;
    return render(
        <OverlayHost>
            <Menu.Root defaultOpen>
                <Menu.Trigger><text>File</text></Menu.Trigger>
                <Menu.Popup>
                    <Menu.Item value="new"><text>New</text></Menu.Item>
                    {shareModel ? (
                        <Menu.Sub model={() => shareModel.open} onOpenChange={(v: boolean) => log.push(`share:${v}`)}>
                            <Menu.SubTrigger><text>Share</text></Menu.SubTrigger>
                            <Menu.SubPopup>
                                <Menu.Item value="email"><text>Email</text></Menu.Item>
                            </Menu.SubPopup>
                        </Menu.Sub>
                    ) : (
                        <Menu.Sub defaultOpen={options.shareOpen} onOpenChange={(v: boolean) => log.push(`share:${v}`)}>
                            <Menu.SubTrigger><text>Share</text></Menu.SubTrigger>
                            <Menu.SubPopup>
                                <Menu.Item value="email"><text>Email</text></Menu.Item>
                            </Menu.SubPopup>
                        </Menu.Sub>
                    )}
                    <Menu.Sub defaultOpen={options.exportOpen} onOpenChange={(v: boolean) => log.push(`export:${v}`)}>
                        <Menu.SubTrigger><text>Export</text></Menu.SubTrigger>
                        <Menu.SubPopup>
                            <Menu.Item value="pdf"><text>PDF</text></Menu.Item>
                            <Menu.Sub>
                                <Menu.SubTrigger><text>Image</text></Menu.SubTrigger>
                                <Menu.SubPopup>
                                    <Menu.Item value="png"><text>PNG</text></Menu.Item>
                                </Menu.SubPopup>
                            </Menu.Sub>
                            <Menu.Sub>
                                <Menu.SubTrigger><text>Data</text></Menu.SubTrigger>
                                <Menu.SubPopup>
                                    <Menu.Item value="csv"><text>CSV</text></Menu.Item>
                                </Menu.SubPopup>
                            </Menu.Sub>
                        </Menu.SubPopup>
                    </Menu.Sub>
                </Menu.Popup>
            </Menu.Root>
        </OverlayHost>,
    );
}

describe('Menu — sibling submenus are mutually exclusive (#1273)', () => {
    it('opening a sibling closes the open one: one sub-popup, one open trigger', async () => {
        const log: string[] = [];
        const { container } = renderMenu({ shareOpen: true, log });
        await settle();
        expect(openSubs(container)).toEqual(['Email']);

        await act(() => fireEvent.tap(subTrigger(container, 'Export') as never));
        await settle();
        expect(openSubs(container)).toHaveLength(1);
        expect(openSubs(container)[0]).toContain('PDF');
        expect(subTrigger(container, 'Share').props['data-state']).toBe('closed');
        expect(subTrigger(container, 'Export').props['data-state']).toBe('open');
        expect([...log].sort()).toEqual(['export:true', 'share:false']);
        expectAnatomy(container as never, anatomies.menu, MENU_PORTALED);
        expectClassGrammar(container as never, anatomies.menu);

        // And back: the first sibling reopens and closes the second.
        await act(() => fireEvent.tap(subTrigger(container, 'Share') as never));
        await settle();
        expect(openSubs(container)).toEqual(['Email']);
        expect(subTrigger(container, 'Export').props['data-state']).toBe('closed');
    });

    it('two siblings with defaultOpen: the later one wins', async () => {
        const { container } = renderMenu({ shareOpen: true, exportOpen: true });
        await settle();
        expect(openSubs(container)).toHaveLength(1);
        expect(openSubs(container)[0]).toContain('PDF');
        expect(subTrigger(container, 'Share').props['data-state']).toBe('closed');
    });

    it('a two-way model is closed through its model when a sibling opens', async () => {
        const shareModel = signal({ open: true });
        const log: string[] = [];
        const { container } = renderMenu({ shareModel, log });
        await settle();
        expect(openSubs(container)).toEqual(['Email']);

        await act(() => fireEvent.tap(subTrigger(container, 'Export') as never));
        await settle();
        expect(shareModel.open).toBe(false);
        expect(openSubs(container)).toHaveLength(1);
        expect(openSubs(container)[0]).toContain('PDF');

        // The app reopening Share through its model closes Export.
        await act(() => { shareModel.open = true; });
        await settle();
        expect(openSubs(container)).toEqual(['Email']);
        expect(subTrigger(container, 'Export').props['data-state']).toBe('closed');
    });

    it('exclusivity is per level: a nested sub opens under its parent, and nested siblings exclude each other', async () => {
        const { container } = renderMenu({ exportOpen: true });
        await settle();
        await act(() => fireEvent.tap(subTrigger(container, 'Image') as never));
        await settle();
        // Export stays open: Image is its child, not its sibling.
        expect(openSubs(container)).toHaveLength(2);
        expect(subTrigger(container, 'Export').props['data-state']).toBe('open');
        expect(openSubs(container)[1]).toBe('PNG');

        await act(() => fireEvent.tap(subTrigger(container, 'Data') as never));
        await settle();
        expect(openSubs(container)).toHaveLength(2);
        expect(openSubs(container)[1]).toBe('CSV');
        expect(subTrigger(container, 'Image').props['data-state']).toBe('closed');
        expect(subTrigger(container, 'Export').props['data-state']).toBe('open');
    });

    it('a sibling closed by a new opening leaves the dismiss stack consistent', async () => {
        const { container } = renderMenu({ shareOpen: true });
        await settle();
        await act(() => fireEvent.tap(subTrigger(container, 'Export') as never));
        await settle();
        // Back closes the one open submenu, then the root popup.
        await act(() => { dismissTopLayer(); });
        await settle();
        expect(openSubs(container)).toEqual([]);
        expect(allParts(container, 'popup')).toHaveLength(1);
        await act(() => { dismissTopLayer(); });
        await settle();
        expect(allParts(container, 'popup')).toHaveLength(0);
    });

    it('a submenu closed by its own trigger frees the slot: the sibling then opens alone', async () => {
        const { container } = renderMenu({ shareOpen: true });
        await settle();
        await act(() => fireEvent.tap(subTrigger(container, 'Share') as never));
        await settle();
        expect(openSubs(container)).toEqual([]);
        await act(() => fireEvent.tap(subTrigger(container, 'Export') as never));
        await settle();
        expect(openSubs(container)).toHaveLength(1);
        expect(subTrigger(container, 'Share').props['data-state']).toBe('closed');
    });
});
