/**
 * Pilot components, wave 3 — the composites (#1054): Select (options +
 * overlay + anchored popup + layer-stack dismissal, incl. nested inside a
 * dialog) and Slider (touch-driven value over the track's measured rect).
 * Conformance asserted while open/measured, as ever.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, touch } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import {
    Dialog, OverlayHost, Select, Slider, clearDismissLayers, dismissTopLayer,
} from '../src/index';
import type { SelectOption } from '../src/index';
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

const allParts = (root: TestNode, scope: string, part: string): TestNode[] => {
    const out: TestNode[] = [];
    const walk = (n: TestNode): void => {
        if (n.props['data-scope'] === scope && n.props['data-part'] === part) out.push(n);
        for (const child of n.children) walk(child);
    };
    walk(root);
    return out;
};

/** Fire a synthetic layoutchange (fireEvent has no helper for it). */
const fireLayout = (node: TestNode, rect: { left: number; top: number; width: number; height: number }): void => {
    const handlers = (node as unknown as { _handlers: Map<string, (e: unknown) => void> })._handlers;
    handlers.get('bindlayoutchange')?.({
        detail: {
            ...rect,
            right: rect.left + rect.width,
            bottom: rect.top + rect.height,
        },
    });
};

const OPTIONS: SelectOption[] = [
    { value: 'apple', label: 'Apple', group: 'Fruit' },
    { value: 'banana', label: 'Banana', group: 'Fruit' },
    { value: 'carrot', label: 'Carrot', group: 'Veg', disabled: true },
    { value: 'other', label: 'Other' },
];

describe('Select', () => {
    it('opens from the trigger, conforms, selects an item, closes', async () => {
        const picked: string[] = [];
        const { container } = render(
            <OverlayHost>
                <Select.Root
                    options={OPTIONS}
                    placeholder="Pick one"
                    label="Snack"
                    color="primary"
                    onValueChange={(v: string) => picked.push(v)}
                />
            </OverlayHost>,
        );
        const trigger = byPart(container, 'select', 'trigger')!;
        expect(trigger._class).toContain('zx-f-placeholder');
        expect(byPart(container, 'select', 'value')!._class).toContain('zx-f-placeholder');
        expect(container.textContent()).toContain('Pick one');
        expect(byPart(container, 'select', 'popup')).toBeNull();

        await act(() => fireEvent.tap(trigger as never));
        await act(() => {});
        const popup = byPart(container, 'select', 'popup')!;
        expect(popup).not.toBeNull();
        // Grouped options render group + group-label; ungrouped stay flat.
        expect(container.textContent()).toContain('Fruit');
        expect(allParts(container, 'select', 'group').length).toBe(2);
        expect(allParts(container, 'select', 'item').length).toBe(4);
        // Axes pushed down into the portaled popup.
        expect(popup._class).toContain('zx-a-color-primary');
        // The popup is outlet-hosted — `portaled` bridges the logical tree.
        expectAnatomy(container as never, anatomies.select, { portaled: ['popup'] });
        expectClassGrammar(container as never, anatomies.select);

        const items = allParts(container, 'select', 'item');
        const banana = items.find((n) => n.textContent().includes('Banana'))!;
        await act(() => fireEvent.tap(banana as never));
        await act(() => {});
        expect(picked).toEqual(['banana']);
        expect(byPart(container, 'select', 'popup')).toBeNull();
        expect(container.textContent()).toContain('Banana');
        expect(byPart(container, 'select', 'trigger')!._class).not.toContain('zx-f-placeholder');

        // Reopen: the chosen item carries the selected flag + indicator.
        await act(() => fireEvent.tap(trigger as never));
        await act(() => {});
        const selected = allParts(container, 'select', 'item').find((n) => n.textContent().includes('Banana'))!;
        expect(selected._class).toContain('zx-f-selected');
        expect(byPart(container, 'select', 'item-indicator')).not.toBeNull();
    });

    it('ignores disabled items and light-dismisses through the layer stack', async () => {
        const picked: string[] = [];
        const { container } = render(
            <OverlayHost>
                <Select.Root options={OPTIONS} onValueChange={(v: string) => picked.push(v)} />
            </OverlayHost>,
        );
        const trigger = byPart(container, 'select', 'trigger')!;
        await act(() => fireEvent.tap(trigger as never));
        await act(() => {});
        const carrot = allParts(container, 'select', 'item').find((n) => n.textContent().includes('Carrot'))!;
        expect(carrot._class).toContain('zx-f-disabled');
        await act(() => fireEvent.tap(carrot as never));
        await act(() => {});
        expect(picked).toEqual([]);
        expect(byPart(container, 'select', 'popup')).not.toBeNull();

        // The transparent outside surface routes through the stack.
        const popup = byPart(container, 'select', 'popup')!;
        await act(() => fireEvent.tap(popup.parent as never));
        await act(() => {});
        expect(byPart(container, 'select', 'popup')).toBeNull();
    });

    it('nested inside a dialog dismisses innermost-first', async () => {
        const { container } = render(
            <OverlayHost>
                <Dialog.Root defaultOpen>
                    <Dialog.Popup>
                        <Select.Root options={OPTIONS} placeholder="Nested" />
                    </Dialog.Popup>
                </Dialog.Root>
            </OverlayHost>,
        );
        await act(() => {});
        const trigger = byPart(container, 'select', 'trigger')!;
        await act(() => fireEvent.tap(trigger as never));
        await act(() => {});
        expect(byPart(container, 'select', 'popup')).not.toBeNull();

        expect(dismissTopLayer()).toBe(true);
        await act(() => {});
        expect(byPart(container, 'select', 'popup')).toBeNull();
        expect(byPart(container, 'dialog', 'popup')).not.toBeNull();

        expect(dismissTopLayer()).toBe(true);
        await act(() => {});
        expect(byPart(container, 'dialog', 'popup')).toBeNull();
    });
});

describe('Slider', () => {
    const dragProbe = () => render(
        <Slider.Root
            min={0}
            max={100}
            defaultValue={20}
            marks={[0, 50, 100]}
            label="Volume"
            showValue
            color="primary"
        />,
    );

    it('renders the anatomy and paints the value as track percentages', async () => {
        const { container } = dragProbe();
        expectAnatomy(container as never, anatomies.slider);
        expectClassGrammar(container as never, anatomies.slider);
        expect(byPart(container, 'slider', 'range')!._style['width']).toBe('20%');
        expect(byPart(container, 'slider', 'thumb')!._style['left']).toBe('20%');
        expect(allParts(container, 'slider', 'mark').length).toBe(3);
        expect(container.textContent()).toContain('Volume');
        expect(container.textContent()).toContain('20');
    });

    it('drags: touch position over the measured track drives the value', async () => {
        const changes: number[] = [];
        const { container } = render(
            <Slider.Root min={0} max={100} defaultValue={0} onValueChange={(v: number) => changes.push(v)} />,
        );
        const control = byPart(container, 'slider', 'control')!;
        const track = byPart(container, 'slider', 'track')!;

        // Unmeasured: a touch cannot resolve to a value, so nothing moves.
        await act(() => fireEvent.touchStart(control as never, { touches: [touch(150, 10)] }));
        expect(changes).toEqual([]);
        await act(() => fireEvent.touchEnd(control as never));

        await act(() => { fireLayout(track, { left: 100, top: 0, width: 200, height: 20 }); });
        await act(() => fireEvent.touchStart(control as never, { touches: [touch(200, 10)] }));
        expect(changes).toEqual([50]);
        // Pressed rides the drag on control AND thumb.
        expect(byPart(container, 'slider', 'control')!._class).toContain('zx-f-pressed');
        expect(byPart(container, 'slider', 'thumb')!._class).toContain('zx-f-pressed');

        await act(() => fireEvent.touchMove(control as never, { touches: [touch(250, 10)] }));
        expect(changes).toEqual([50, 75]);
        expect(byPart(container, 'slider', 'range')!._style['width']).toBe('75%');
        expect(byPart(container, 'slider', 'thumb')!._style['left']).toBe('75%');

        // Off-track touches clamp to the range ends.
        await act(() => fireEvent.touchMove(control as never, { touches: [touch(400, 10)] }));
        expect(changes).toEqual([50, 75, 100]);

        await act(() => fireEvent.touchEnd(control as never));
        expect(byPart(container, 'slider', 'thumb')!._class).not.toContain('zx-f-pressed');
        // Released: moves are ignored until the next touch down.
        await act(() => fireEvent.touchMove(control as never, { touches: [touch(150, 10)] }));
        expect(changes).toEqual([50, 75, 100]);
    });

    it('snaps to step and ignores touches while disabled', async () => {
        const changes: number[] = [];
        const { container } = render(
            <Slider.Root min={0} max={100} step={25} defaultValue={0} onValueChange={(v: number) => changes.push(v)} />,
        );
        const control = byPart(container, 'slider', 'control')!;
        await act(() => { fireLayout(byPart(container, 'slider', 'track')!, { left: 0, top: 0, width: 100, height: 20 }); });
        // 30% of the range snaps to the nearest step (25).
        await act(() => fireEvent.touchStart(control as never, { touches: [touch(30, 10)] }));
        expect(changes).toEqual([25]);
        await act(() => fireEvent.touchEnd(control as never));

        const { container: off } = render(
            <Slider.Root min={0} max={100} defaultValue={40} disabled onValueChange={(v: number) => changes.push(v)} />,
        );
        const offControl = byPart(off, 'slider', 'control')!;
        expect(byPart(off, 'slider', 'root')!._class).toContain('zx-f-disabled');
        await act(() => { fireLayout(byPart(off, 'slider', 'track')!, { left: 0, top: 0, width: 100, height: 20 }); });
        await act(() => fireEvent.touchStart(offControl as never, { touches: [touch(90, 10)] }));
        expect(changes).toEqual([25]);
        expect(byPart(off, 'slider', 'range')!._style['width']).toBe('40%');
    });
});
