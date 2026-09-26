/**
 * zero 0.6 anatomy for the overlay trio (#1146): Select's clear-trigger,
 * separator, readonly and open model (zero#321); the default glyphs lynx
 * has no pseudo-elements for; Dialog.Cancel; disabled Close/Cancel on
 * Dialog and Popover. Conformance asserted while open, as ever.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { Dialog, OverlayHost, Popover, Select, clearDismissLayers } from '../src/index';
import { expectAnatomy, expectClassGrammar } from '../src/testing/index';

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
    { value: 'other', label: 'Other' },
];

describe('Select — zero 0.6 parts', () => {
    it('renders the default glyphs as text: ▾ in the indicator, ✓ in the selected item', async () => {
        const { container } = render(
            <OverlayHost>
                <Select.Root items={SNACKS} itemValue={(o) => o.value} defaultValue="banana" defaultOpen />
            </OverlayHost>,
        );
        await act(() => {});
        expect(byPart(container, 'select', 'indicator')!.textContent()).toBe('▾');
        const indicators = allParts(container, 'select', 'item-indicator');
        expect(indicators.length).toBe(1);
        expect(indicators[0]!.textContent()).toBe('✓');
        expect(indicators[0]!._class).toContain('zx-f-selected');
    });

    it('clearable: a clear-trigger beside the trigger while a value is selected; tapping it clears', async () => {
        const changes: Array<string | null> = [];
        const { container } = render(
            <OverlayHost>
                <Select.Root
                    items={SNACKS}
                    itemValue={(o) => o.value}
                    defaultValue="apple"
                    placeholder="Pick"
                    clearable
                    color="accent"
                    onValueChange={(v) => changes.push(v)}
                />
            </OverlayHost>,
        );
        const clear = byPart(container, 'select', 'clear-trigger')!;
        expect(clear).not.toBeNull();
        // A sibling of the trigger inside the root, never inside the trigger.
        expect(clear.parent!.props['data-part']).toBe('root');
        expect(clear.props['accessibility-label']).toBe('Clear selection');
        expect(clear.textContent()).toBe('×');
        expect(clear._class).toContain('zx-a-color-accent');
        expectAnatomy(container as never, anatomies.select);
        expectClassGrammar(container as never, anatomies.select);

        await act(() => fireEvent.tap(clear as never));
        await act(() => {});
        expect(changes).toEqual([null]);
        expect(container.textContent()).toContain('Pick');
        expect(byPart(container, 'select', 'trigger')!._class).toContain('zx-f-placeholder');
        // Nothing selected → the clear-trigger leaves with the value.
        expect(byPart(container, 'select', 'clear-trigger')).toBeNull();
        // It never opened the popup on its way.
        expect(byPart(container, 'select', 'popup')).toBeNull();
    });

    it('no clear-trigger while disabled, readonly, or not clearable', () => {
        for (const extra of [{ disabled: true }, { readonly: true }, { clearable: false }]) {
            const { container } = render(
                <OverlayHost>
                    <Select.Root items={SNACKS} itemValue={(o) => o.value} defaultValue="apple" clearable {...extra} />
                </OverlayHost>,
            );
            expect(byPart(container, 'select', 'clear-trigger')).toBeNull();
        }
    });

    it('readonly: flags root + trigger, does not open, does not light up', async () => {
        const { container } = render(
            <OverlayHost>
                <Select.Root items={SNACKS} itemValue={(o) => o.value} defaultValue="apple" readonly />
            </OverlayHost>,
        );
        const root = byPart(container, 'select', 'root')!;
        const trigger = byPart(container, 'select', 'trigger')!;
        expect(root._class).toContain('zx-f-readonly');
        expect(trigger._class).toContain('zx-f-readonly');
        expect(trigger.props['data-readonly']).toBe('');
        await act(() => fireEvent.tap(trigger as never));
        await act(() => {});
        expect(byPart(container, 'select', 'popup')).toBeNull();
        expectAnatomy(container as never, anatomies.select);
        expectClassGrammar(container as never, anatomies.select);
    });

    it('readonly while open (defaultOpen): items are inert — no write, no close', async () => {
        const changes: Array<string | null> = [];
        const { container } = render(
            <OverlayHost>
                <Select.Root items={SNACKS} itemValue={(o) => o.value} defaultOpen readonly onValueChange={(v) => changes.push(v)} />
            </OverlayHost>,
        );
        await act(() => {});
        const banana = allParts(container, 'select', 'item').find((n) => n.textContent().includes('Banana'))!;
        await act(() => fireEvent.tap(banana as never));
        await act(() => {});
        expect(changes).toEqual([]);
        expect(byPart(container, 'select', 'popup')).not.toBeNull();
    });

    it('groupSeparators: a separator between consecutive runs, none before the first', async () => {
        const { container } = render(
            <OverlayHost>
                <Select.Root items={SNACKS} itemValue={(o) => o.value} itemGroup={(o) => o.group} defaultOpen groupSeparators color="primary" />
            </OverlayHost>,
        );
        await act(() => {});
        // Fruit · Veg · (ungrouped) → three runs, two rules.
        const separators = allParts(container, 'select', 'separator');
        expect(separators.length).toBe(2);
        const popup = byPart(container, 'select', 'popup')!;
        const parts = popup.children.map((c) => c.props['data-part']).filter(Boolean);
        expect(parts.slice(0, 3)).toEqual(['group', 'separator', 'group']);
        expect(separators[0]!._class).toContain('zx-a-color-primary');
        expectAnatomy(container as never, anatomies.select, { portaled: ['popup'] });
        expectClassGrammar(container as never, anatomies.select);
    });

    it('no separators without groupSeparators', async () => {
        const { container } = render(
            <OverlayHost>
                <Select.Root items={SNACKS} itemValue={(o) => o.value} itemGroup={(o) => o.group} defaultOpen />
            </OverlayHost>,
        );
        await act(() => {});
        expect(allParts(container, 'select', 'separator').length).toBe(0);
    });

    it('the open model emits openChange on open, pick and light dismiss', async () => {
        const opens: boolean[] = [];
        const { container } = render(
            <OverlayHost>
                <Select.Root items={SNACKS} itemValue={(o) => o.value} onOpenChange={(v) => opens.push(v)} />
            </OverlayHost>,
        );
        const trigger = byPart(container, 'select', 'trigger')!;
        await act(() => fireEvent.tap(trigger as never));
        await act(() => {});
        const apple = allParts(container, 'select', 'item').find((n) => n.textContent().includes('Apple'))!;
        await act(() => fireEvent.tap(apple as never));
        await act(() => {});
        await act(() => fireEvent.tap(trigger as never));
        await act(() => {});
        const popup = byPart(container, 'select', 'popup')!;
        await act(() => fireEvent.tap(popup.parent as never));
        await act(() => {});
        expect(opens).toEqual([true, false, true, false]);
    });
});

describe('Dialog — Cancel and disabled actions', () => {
    it('Cancel is its own part and closes; a disabled Close does not', async () => {
        const opens: boolean[] = [];
        const { container } = render(
            <OverlayHost>
                <Dialog.Root defaultOpen color="primary" onOpenChange={(v) => opens.push(v)}>
                    <Dialog.Trigger><text>Open</text></Dialog.Trigger>
                    <Dialog.Popup>
                        <Dialog.Title>Delete?</Dialog.Title>
                        <Dialog.Footer>
                            <Dialog.Cancel><text>Keep</text></Dialog.Cancel>
                            <Dialog.Close disabled><text>Delete</text></Dialog.Close>
                        </Dialog.Footer>
                    </Dialog.Popup>
                </Dialog.Root>
            </OverlayHost>,
        );
        await act(() => {});
        const cancel = byPart(container, 'dialog', 'cancel')!;
        const close = byPart(container, 'dialog', 'close')!;
        expect(cancel.props['accessibility-label']).toBe('Cancel');
        expect(cancel._class).toContain('zx-a-color-primary');
        expect(close._class).toContain('zx-f-disabled');
        expectAnatomy(container as never, anatomies.dialog);
        expectClassGrammar(container as never, anatomies.dialog);

        await act(() => fireEvent.tap(close as never));
        await act(() => {});
        expect(byPart(container, 'dialog', 'popup')).not.toBeNull();
        expect(opens).toEqual([]);

        await act(() => fireEvent.tap(cancel as never));
        await act(() => {});
        expect(byPart(container, 'dialog', 'popup')).toBeNull();
        expect(opens).toEqual([false]);
    });
});

describe('Popover — disabled Close', () => {
    it('a disabled Close carries the flag and does not close', async () => {
        const { container } = render(
            <OverlayHost>
                <Popover.Root defaultOpen>
                    <Popover.Trigger><text>Open</text></Popover.Trigger>
                    <Popover.Popup>
                        <Popover.Title>Info</Popover.Title>
                        <Popover.Close disabled label="Dismiss"><text>×</text></Popover.Close>
                    </Popover.Popup>
                </Popover.Root>
            </OverlayHost>,
        );
        await act(() => {});
        const close = byPart(container, 'popover', 'close')!;
        expect(close._class).toContain('zx-f-disabled');
        expect(close.props['accessibility-label']).toBe('Dismiss');
        await act(() => fireEvent.tap(close as never));
        await act(() => {});
        expect(byPart(container, 'popover', 'popup')).not.toBeNull();
        expectAnatomy(container as never, anatomies.popover, { portaled: ['popup'] });
        expectClassGrammar(container as never, anatomies.popover);
    });
});
