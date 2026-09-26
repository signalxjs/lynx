/**
 * `ForceStates` (#1141) — display-forced interaction flags for the
 * state-matrix gallery. The claims: a forced flag lands on exactly the parts
 * whose anatomy declares it (both halves — class + data attribute — so both
 * oracles still pass), `parts` narrows it, a forced `false` beats the live
 * value, a nested forcing inside a carrier keeps the carrier's axes, and
 * the carrier's own part sees it too (the root stamps from the provided
 * reader).
 */
import { describe, expect, it } from 'vitest';
import { act, render } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { component, signal } from '@sigx/lynx';
import { Button, Select, Switch, Tabs, ZeroRoot, partBag } from '../src/index';
import { ForceStates, expectAnatomy, expectClassGrammar } from '../src/testing/index';

type Node = { props: Record<string, unknown>; children: Node[]; _class?: string };

function partsOf(root: Node, scope: string, part: string, out: Node[] = []): Node[] {
    if (root.props['data-scope'] === scope && root.props['data-part'] === part) out.push(root);
    for (const child of root.children) partsOf(child, scope, part, out);
    return out;
}

const conforms = (container: never, scope: keyof typeof anatomies): void => {
    expectAnatomy(container, anatomies[scope]);
    expectClassGrammar(container, anatomies[scope]);
};

describe('ForceStates', () => {
    it("forces a flag on the carrier's own part (button root)", () => {
        const { container } = render(
            <ForceStates flags={{ pressed: true, 'focus-visible': true }}>
                <Button color="primary"><text>Held</text></Button>
            </ForceStates>,
        );
        const [root] = partsOf(container as never, 'button', 'root');
        expect(root!._class).toContain('zx-f-pressed');
        expect(root!._class).toContain('zx-f-focus-visible');
        expect(root!.props['data-pressed']).toBe('');
        expect(root!._class).toContain('zx-a-color-primary');
        conforms(container as never, 'button');
    });

    it('lands only on parts that declare the flag (switch: pressed → control)', () => {
        const { container } = render(
            <ForceStates flags={{ pressed: true }}>
                <Switch defaultChecked>On</Switch>
            </ForceStates>,
        );
        const root = partsOf(container as never, 'switch', 'root')[0]!;
        const control = partsOf(container as never, 'switch', 'control')[0]!;
        const thumb = partsOf(container as never, 'switch', 'thumb')[0]!;
        expect(control._class).toContain('zx-f-pressed');
        expect(root._class).not.toContain('zx-f-pressed');
        expect(thumb._class).not.toContain('zx-f-pressed');
        expect(root.props['data-pressed']).toBeUndefined();
        conforms(container as never, 'switch');
    });

    it('`parts` narrows the forcing; a forced false beats the live value', () => {
        const { container } = render(
            <ForceStates flags={{ disabled: false, 'focus-visible': true }} parts={['control']}>
                <Switch disabled>Off</Switch>
            </ForceStates>,
        );
        const root = partsOf(container as never, 'switch', 'root')[0]!;
        const control = partsOf(container as never, 'switch', 'control')[0]!;
        expect(control._class).toContain('zx-f-focus-visible');
        expect(control._class).not.toContain('zx-f-disabled');
        // The root is outside `parts`: live disabled stays, no focus ring.
        expect(root._class).toContain('zx-f-disabled');
        expect(root._class).not.toContain('zx-f-focus-visible');
        conforms(container as never, 'switch');
    });

    it('nested inside a carrier: forces one tab, keeps the carrier axes', () => {
        const { container } = render(
            <Tabs.Root defaultValue="a" color="primary" size="sm">
                <Tabs.List>
                    <Tabs.Tab value="a"><text>A</text></Tabs.Tab>
                    <ForceStates flags={{ pressed: true }}>
                        <Tabs.Tab value="b"><text>B</text></Tabs.Tab>
                    </ForceStates>
                </Tabs.List>
            </Tabs.Root>,
        );
        const [a, b] = partsOf(container as never, 'tabs', 'tab');
        expect(a!._class).not.toContain('zx-f-pressed');
        expect(b!._class).toContain('zx-f-pressed');
        expect(b!._class).toContain('zx-a-color-primary');
        expect(b!._class).toContain('zx-a-size-sm');
        conforms(container as never, 'tabs');
    });

    it('is reactive and a nearer forcing replaces an outer one', async () => {
        const flags = signal({ current: { pressed: true } as Record<string, boolean> });
        const Probe = component(() => () => (
            <ForceStates flags={flags.current}>
                <Button><text>Outer</text></Button>
                <ForceStates flags={{ 'focus-visible': true }}>
                    <Button><text>Inner</text></Button>
                </ForceStates>
            </ForceStates>
        ));
        const { container } = render(<Probe />);
        const [outer, inner] = partsOf(container as never, 'button', 'root');
        expect(outer!._class).toContain('zx-f-pressed');
        expect(inner!._class).toContain('zx-f-focus-visible');
        expect(inner!._class).not.toContain('zx-f-pressed');
        await act(() => { flags.current = { pressed: false }; });
        expect(outer!._class).not.toContain('zx-f-pressed');
    });

    it('reaches select items through the axes the root hands them; defaultOpen renders the popup', async () => {
        const { container } = render(
            <ZeroRoot>
                <ForceStates flags={{ highlighted: true }} parts={['item']}>
                    <Select.Root defaultOpen items={['a', 'b']} defaultValue="a" />
                </ForceStates>
            </ZeroRoot>,
        );
        await act(() => {});
        const trigger = partsOf(container as never, 'select', 'trigger')[0];
        expect(trigger?.props['data-state']).toBe('open');
        const items = partsOf(container as never, 'select', 'item');
        expect(items).toHaveLength(2);
        for (const item of items) expect(item._class).toContain('zx-f-highlighted');
        expect(trigger!._class).not.toContain('zx-f-highlighted');
    });

    it('partBag without forced flags is unchanged', () => {
        const bag = partBag(anatomies.button, 'root', { flags: { pressed: false } });
        expect(bag.class).toBe('zx-button__root');
        const forced = partBag(anatomies.button, 'spinner', { forced: { flags: { pressed: true } } });
        expect(forced.class).toBe('zx-button__spinner');
    });
});
