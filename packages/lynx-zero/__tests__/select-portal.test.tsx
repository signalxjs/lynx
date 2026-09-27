/**
 * Select's portalled popup (#1166–#1168). The popup renders in the overlay
 * outlet, not under the root, so two things the web gets from the DOM tree
 * have to be restated here:
 *
 * - the list's block flow: a lynx `<view>` is `display: linear`, where the
 *   rows and the separator shrink to their content (#1167);
 * - the colour axis: every portalled part must stamp the root's axis class,
 *   because the skin re-scopes its accent on the popup's own compound
 *   (`.zx-select__popup.zx-a-color-*`) — nothing inherits across the
 *   portal (#1168).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { component, signal } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { OverlayHost, Select, clearDismissLayers } from '../src/index';
import { ForceStates, expectAnatomy, expectClassGrammar } from '../src/testing/index';

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

interface Snack {
    value: string;
    label: string;
    group?: string;
}

const SNACKS: Snack[] = [
    { value: 'apple', label: 'Apple', group: 'Fruit' },
    { value: 'banana', label: 'Banana', group: 'Fruit' },
    { value: 'carrot', label: 'Carrot', group: 'Veg' },
];

describe('Select — portalled popup layout (#1167)', () => {
    it('the popup and each group are flex columns, so rows and separators span the list', async () => {
        const { container } = render(
            <OverlayHost>
                <Select.Root items={SNACKS} itemValue={(o) => o.value} itemGroup={(o) => o.group} defaultOpen groupSeparators color="primary" />
            </OverlayHost>,
        );
        await act(() => {});
        const popup = byPart(container, 'select', 'popup')!;
        expect(popup._style.display).toBe('flex');
        expect(popup._style.flexDirection).toBe('column');
        // The anchored-position style still rides along (not replaced).
        expect(popup._style.position).toBe('absolute');
        const groups = allParts(container, 'select', 'group');
        expect(groups.length).toBe(2);
        for (const group of groups) {
            expect(group._style.display).toBe('flex');
            expect(group._style.flexDirection).toBe('column');
        }
        // The separator is a direct child of the popup's flex column — the
        // column stretches it; it has no width of its own.
        const separator = byPart(container, 'select', 'separator')!;
        expect(separator.parent).toBe(popup);
        expectAnatomy(container as never, anatomies.select, { portaled: ['popup'] });
        expectClassGrammar(container as never, anatomies.select);
    });
});

describe('Select — colour axis across the portal (#1168)', () => {
    it('popup, items, selected tick and separator all stamp the root\'s colour', async () => {
        const { container } = render(
            <OverlayHost>
                <Select.Root
                    items={SNACKS}
                    itemValue={(o) => o.value}
                    itemGroup={(o) => o.group}
                    defaultValue="banana"
                    defaultOpen
                    groupSeparators
                    color="secondary"
                />
            </OverlayHost>,
        );
        await act(() => {});
        const popup = byPart(container, 'select', 'popup')!;
        expect(popup._class).toContain('zx-a-color-secondary');
        for (const part of ['item', 'item-indicator', 'separator', 'group', 'group-label']) {
            const nodes = allParts(container, 'select', part);
            expect(nodes.length, part).toBeGreaterThan(0);
            for (const node of nodes) expect(node._class, part).toContain('zx-a-color-secondary');
        }
        // The tick is the selected item's, and carries its flag.
        const tick = byPart(container, 'select', 'item-indicator')!;
        expect(tick._class).toContain('zx-f-selected');
        expect(tick.parent!.textContent()).toContain('Banana');
    });

    it('follows a colour change while open', async () => {
        const color = signal({ value: 'primary' });
        const Host = component(() => () => (
            <Select.Root items={SNACKS} itemValue={(o) => o.value} defaultValue="apple" defaultOpen color={color.value} />
        ));
        const { container } = render(
            <OverlayHost>
                <Host />
            </OverlayHost>,
        );
        await act(() => {});
        expect(byPart(container, 'select', 'item-indicator')!._class).toContain('zx-a-color-primary');
        await act(() => {
            color.value = 'error';
        });
        await act(() => {});
        expect(byPart(container, 'select', 'trigger')!._class).toContain('zx-a-color-error');
        expect(byPart(container, 'select', 'popup')!._class).toContain('zx-a-color-error');
        expect(byPart(container, 'select', 'item-indicator')!._class).toContain('zx-a-color-error');
        expect(byPart(container, 'select', 'item-indicator')!._class).not.toContain('zx-a-color-primary');
    });

    it('ForceStates reaches the portalled items with the colour intact', async () => {
        const { container } = render(
            <OverlayHost>
                <ForceStates flags={{ pressed: true }} parts={['item']}>
                    <Select.Root items={SNACKS} itemValue={(o) => o.value} defaultValue="banana" defaultOpen color="accent" />
                </ForceStates>
            </OverlayHost>,
        );
        await act(() => {});
        const items = allParts(container, 'select', 'item');
        expect(items.length).toBe(3);
        for (const item of items) {
            expect(item._class).toContain('zx-f-pressed');
            expect(item._class).toContain('zx-a-color-accent');
        }
        // Narrowed to items: the trigger is not forced.
        expect(byPart(container, 'select', 'trigger')!._class).not.toContain('zx-f-pressed');
    });
});
