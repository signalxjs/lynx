/**
 * Wave 1B (#1144, epic #1140): Switch, Slider and Progress brought to the
 * zero 0.6 anatomy — `readonly` on the form controls, Slider's range model,
 * vertical orientation, `valueCommit` and Android-correct touch geometry,
 * Progress's `min`, degenerate range and formatted value text. Every state
 * the test drives is held to BOTH oracles (anatomy + class grammar).
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, touch } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { signal } from '@sigx/lynx';
import { Progress, Slider, Switch } from '../src/index';
import { sliderFraction } from '../src/components/slider/Slider';
import { ForceStates, expectAnatomy, expectClassGrammar } from '../src/testing/index';

const conforms = (container: unknown, scope: keyof typeof anatomies): void => {
    expectAnatomy(container as never, anatomies[scope]);
    expectClassGrammar(container as never, anatomies[scope]);
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
const byPart = (root: TestNode, scope: string, part: string): TestNode => {
    const found = allParts(root, scope, part)[0];
    if (!found) throw new Error(`no ${scope}.${part}`);
    return found;
};

const fireLayout = (node: TestNode, rect: { left: number; top: number; width: number; height: number }): void => {
    const handlers = (node as unknown as { _handlers: Map<string, (e: unknown) => void> })._handlers;
    handlers.get('bindlayoutchange')?.({
        detail: { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height },
    });
};

describe('Switch — readonly (zero 0.6)', () => {
    it('stamps readonly on root + control, refuses taps and shows no press', async () => {
        const changes: boolean[] = [];
        const { container } = render(
            <Switch.Root readonly defaultChecked label="Locked" onCheckedChange={(v: boolean) => changes.push(v)} />,
        );
        const root = byPart(container, 'switch', 'root');
        expect(root._class).toContain('zx-f-readonly');
        expect(byPart(container, 'switch', 'control')._class).toContain('zx-f-readonly');
        await act(() => fireEvent.touchStart(root as never, { touches: [touch(1, 1)] }));
        expect(byPart(container, 'switch', 'control')._class).not.toContain('zx-f-pressed');
        await act(() => fireEvent.touchEnd(root as never));
        await act(() => fireEvent.tap(root as never));
        expect(changes).toEqual([]);
        expect(byPart(container, 'switch', 'root').props['data-state']).toBe('checked');
        conforms(container, 'switch');
    });

    it('a writable switch still presses and toggles', async () => {
        const changes: boolean[] = [];
        const { container } = render(<Switch.Root onCheckedChange={(v: boolean) => changes.push(v)} />);
        const root = byPart(container, 'switch', 'root');
        await act(() => fireEvent.touchStart(root as never, { touches: [touch(1, 1)] }));
        expect(byPart(container, 'switch', 'control')._class).toContain('zx-f-pressed');
        conforms(container, 'switch');
        await act(() => fireEvent.touchEnd(root as never));
        await act(() => fireEvent.tap(root as never));
        expect(changes).toEqual([true]);
    });

    it('invalid + required + forced focus-visible conform together', () => {
        const { container } = render(
            <ForceStates flags={{ 'focus-visible': true }}>
                <Switch.Root invalid required defaultChecked />
            </ForceStates>,
        );
        const control = byPart(container, 'switch', 'control');
        expect(control._class).toContain('zx-f-invalid');
        expect(control._class).toContain('zx-f-focus-visible');
        conforms(container, 'switch');
    });
});

describe('Slider — zero 0.6 projection', () => {
    it('sliderFraction maps page or viewport points along either axis', () => {
        const rect = { left: 100, top: 50, width: 200, height: 100 };
        expect(sliderFraction({ x: 200, y: 0 }, rect)).toBe(0.5);
        expect(sliderFraction({ x: 50, y: 0 }, rect)).toBe(-0.25);
        // Vertical runs bottom-to-top: the rail's foot is 0.
        expect(sliderFraction({ x: 0, y: 150 }, rect, 'vertical')).toBe(0);
        expect(sliderFraction({ x: 0, y: 75 }, rect, 'vertical')).toBe(0.75);
        expect(sliderFraction({ x: 0, y: 0 }, { ...rect, width: 0 })).toBeNull();
        expect(sliderFraction({ x: 0, y: 0 }, { ...rect, height: 0 }, 'vertical')).toBeNull();
    });

    it('readonly: flags root/control/track/thumb, never moves, never presses', async () => {
        const changes: unknown[] = [];
        const { container } = render(
            <Slider.Root readonly defaultValue={40} onValueChange={(v: number | number[]) => changes.push(v)} />,
        );
        for (const part of ['root', 'control', 'track', 'thumb']) {
            expect(byPart(container, 'slider', part)._class).toContain('zx-f-readonly');
        }
        await act(() => { fireLayout(byPart(container, 'slider', 'track'), { left: 0, top: 0, width: 100, height: 20 }); });
        const control = byPart(container, 'slider', 'control');
        await act(() => fireEvent.touchStart(control as never, { touches: [touch(90, 10)] }));
        expect(changes).toEqual([]);
        expect(byPart(container, 'slider', 'thumb')._class).not.toContain('zx-f-pressed');
        expect(byPart(container, 'slider', 'thumb')._style['left']).toBe('40%');
        conforms(container, 'slider');
    });

    it('range model: one thumb per value, the range spans them, the nearest thumb drags and never crosses', async () => {
        const changes: unknown[] = [];
        const commits: unknown[] = [];
        const { container } = render(
            <Slider.Root
                defaultValue={[20, 60]}
                minStepsBetweenThumbs={10}
                showValue
                onValueChange={(v: number | number[]) => changes.push(v)}
                onValueCommit={(v: number | number[]) => commits.push(v)}
            />,
        );
        const thumbs = allParts(container, 'slider', 'thumb');
        expect(thumbs.map((t) => t._style['left'])).toEqual(['20%', '60%']);
        const range = byPart(container, 'slider', 'range');
        expect(range._style['left']).toBe('20%');
        expect(range._style['width']).toBe('40%');
        expect(container.textContent()).toContain('20 – 60');
        conforms(container, 'slider');

        await act(() => { fireLayout(byPart(container, 'slider', 'track'), { left: 0, top: 0, width: 100, height: 20 }); });
        const control = byPart(container, 'slider', 'control');
        // 70 is nearer the upper thumb: it moves, and only it presses.
        await act(() => fireEvent.touchStart(control as never, { touches: [touch(70, 10)] }));
        expect(changes).toEqual([[20, 70]]);
        const pressed = allParts(container, 'slider', 'thumb').map((t) => t._class.includes('zx-f-pressed'));
        expect(pressed).toEqual([false, true]);
        conforms(container, 'slider');
        // Dragged down past the lower thumb: it stops 10 steps above it.
        await act(() => fireEvent.touchMove(control as never, { touches: [touch(5, 10)] }));
        expect(changes.at(-1)).toEqual([20, 30]);
        await act(() => fireEvent.touchEnd(control as never));
        expect(commits).toEqual([[20, 30]]);
    });

    it('an unsorted controlled range model is ordered before it paints or constrains', async () => {
        const changes: unknown[] = [];
        const range0 = signal({ v: [70, 20] });
        const { container } = render(
            <Slider.Root model={() => range0.v} minStepsBetweenThumbs={10} onValueChange={(v: number[]) => changes.push(v)} />,
        );
        const range = byPart(container, 'slider', 'range');
        expect(range._style['left']).toBe('20%');
        expect(range._style['width']).toBe('50%');
        expect(allParts(container, 'slider', 'thumb').map((t) => t._style['left'])).toEqual(['20%', '70%']);
        await act(() => { fireLayout(byPart(container, 'slider', 'track'), { left: 0, top: 0, width: 100, height: 20 }); });
        const control = byPart(container, 'slider', 'control');
        // Near the lower thumb, dragged up into the upper: stops 10 below it.
        await act(() => fireEvent.touchStart(control as never, { touches: [touch(25, 10)] }));
        await act(() => fireEvent.touchMove(control as never, { touches: [touch(95, 10)] }));
        expect(changes.at(-1)).toEqual([60, 70]);
        await act(() => fireEvent.touchEnd(control as never));
    });

    it('a touch payload with only the rail axis still drags; coincident thumbs open by direction', async () => {
        const changes: unknown[] = [];
        const { container } = render(
            <Slider.Root defaultValue={[50, 50]} onValueChange={(v: number | number[]) => changes.push(v)} />,
        );
        await act(() => { fireLayout(byPart(container, 'slider', 'track'), { left: 0, top: 0, width: 100, height: 20 }); });
        const control = byPart(container, 'slider', 'control');
        // No y at all: a horizontal rail needs only x.
        await act(() => fireEvent.touchStart(control as never, { touches: [{ pageX: 80, clientX: 80 } as never] }));
        expect(changes).toEqual([[50, 80]]);
        await act(() => fireEvent.touchEnd(control as never));
    });

    it('valueCommit fires once per drag, only when the value moved, in the model shape', async () => {
        const commits: unknown[] = [];
        const { container } = render(
            <Slider.Root defaultValue={50} onValueCommit={(v: number | number[]) => commits.push(v)} />,
        );
        await act(() => { fireLayout(byPart(container, 'slider', 'track'), { left: 0, top: 0, width: 100, height: 20 }); });
        const control = byPart(container, 'slider', 'control');
        // A touch that lands on the current value moves nothing.
        await act(() => fireEvent.touchStart(control as never, { touches: [touch(50, 10)] }));
        await act(() => fireEvent.touchEnd(control as never));
        expect(commits).toEqual([]);
        await act(() => fireEvent.touchStart(control as never, { touches: [touch(30, 10)] }));
        await act(() => fireEvent.touchMove(control as never, { touches: [touch(80, 10)] }));
        expect(commits).toEqual([]);
        await act(() => fireEvent.touchEnd(control as never));
        expect(commits).toEqual([80]);
    });

    it('vertical: orientation on the root and positioned parts; physical top percentages; drags bottom-to-top', async () => {
        const changes: unknown[] = [];
        const { container } = render(
            <Slider.Root
                orientation="vertical"
                defaultValue={25}
                marks={[0, 50]}
                onValueChange={(v: number | number[]) => changes.push(v)}
            />,
        );
        for (const part of ['root', 'control', 'track', 'range', 'thumb', 'mark']) {
            const node = byPart(container, 'slider', part);
            expect(node._class).toContain('zx-o-vertical');
            expect(node.props['data-orientation']).toBe('vertical');
        }
        const thumb = byPart(container, 'slider', 'thumb');
        expect(thumb._style['top']).toBe('75%');
        expect(thumb._style['left']).toBe('50%');
        const range = byPart(container, 'slider', 'range');
        expect(range._style['top']).toBe('75%');
        expect(range._style['height']).toBe('25%');
        expect(allParts(container, 'slider', 'mark').map((m) => m._style['top'])).toEqual(['100%', '50%']);
        conforms(container, 'slider');

        await act(() => { fireLayout(byPart(container, 'slider', 'track'), { left: 0, top: 100, width: 12, height: 200 }); });
        const control = byPart(container, 'slider', 'control');
        // 50 from the bottom of a 200-tall rail = 25%… then the top = 100.
        await act(() => fireEvent.touchStart(control as never, { touches: [touch(6, 250)] }));
        await act(() => fireEvent.touchMove(control as never, { touches: [touch(6, 90)] }));
        expect(changes).toEqual([100]);
        await act(() => fireEvent.touchMove(control as never, { touches: [touch(6, 200)] }));
        expect(changes).toEqual([100, 50]);
        await act(() => fireEvent.touchEnd(control as never));
    });

    it('forced states (gallery): pressed and focus-visible reach control + thumb; invalid rides the control', () => {
        const { container } = render(
            <ForceStates flags={{ pressed: true, 'focus-visible': true }}>
                <Slider.Root defaultValue={[10, 90]} invalid marks={[50]} />
            </ForceStates>,
        );
        const control = byPart(container, 'slider', 'control');
        expect(control._class).toContain('zx-f-pressed');
        expect(control._class).toContain('zx-f-invalid');
        for (const thumb of allParts(container, 'slider', 'thumb')) {
            expect(thumb._class).toContain('zx-f-pressed');
            expect(thumb._class).toContain('zx-f-focus-visible');
        }
        conforms(container, 'slider');
    });
});

describe('Progress — zero 0.6 value model', () => {
    it('min shifts the fill; state follows the filled share', () => {
        const { container } = render(
            <Progress.Root value={60} min={20} max={120}>
                <Progress.Track><Progress.Range /></Progress.Track>
                <Progress.ValueText />
            </Progress.Root>,
        );
        expect(byPart(container, 'progress', 'range')._style['width']).toBe('40%');
        expect(byPart(container, 'progress', 'root').props['data-state']).toBe('loading');
        expect(container.textContent()).toContain('40%');
        conforms(container, 'progress');
    });

    it('a degenerate range with a value reads as complete, full width — no NaN', () => {
        const { container } = render(
            <Progress.Root value={3} min={5} max={5}><Progress.Track><Progress.Range /></Progress.Track></Progress.Root>,
        );
        expect(byPart(container, 'progress', 'root').props['data-state']).toBe('complete');
        expect(byPart(container, 'progress', 'range')._style['width']).toBe('100%');
        conforms(container, 'progress');
    });

    it('indeterminate writes no inline width (the skin owns the sweep) and no value text', () => {
        const { container } = render(
            <Progress.Root value={null}>
                <Progress.Track><Progress.Range /></Progress.Track>
                <Progress.ValueText />
            </Progress.Root>,
        );
        const range = byPart(container, 'progress', 'range');
        expect(range.props['data-state']).toBe('indeterminate');
        expect(range._style['width']).toBeUndefined();
        expect(byPart(container, 'progress', 'value-text').textContent()).toBe('');
        conforms(container, 'progress');
    });

    it('what is announced is what is shown: getValueText feeds ValueText and the root label', () => {
        const { container } = render(
            <Progress.Root value={3} max={8} label="Upload" getValueText={(v, { max }) => `${v} of ${max} files`}>
                <Progress.Track><Progress.Range /></Progress.Track>
                <Progress.ValueText />
            </Progress.Root>,
        );
        expect(byPart(container, 'progress', 'value-text').textContent()).toBe('3 of 8 files');
        expect(byPart(container, 'progress', 'root').props['accessibility-label']).toBe('Upload, 3 of 8 files');
    });

    it('a ValueText slot still wins over the formatted value', () => {
        const { container } = render(
            <Progress.Root value={50}><Progress.ValueText>custom</Progress.ValueText></Progress.Root>,
        );
        expect(byPart(container, 'progress', 'value-text').textContent()).toBe('custom');
    });
});
