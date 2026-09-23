/**
 * A part that re-carries an axis (#1125, zero `PartSpec.carries`, zero#94):
 * the part is a nearer provider of that axis — its own value outranks the
 * carrier's for itself and every part below it, and without one it follows
 * the carrier. Timeline's marker is the first such part; the adapter tests
 * use a synthetic anatomy so the push-down BELOW a re-carrying part is
 * covered too (no shipped anatomy nests a part under its marker).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, render } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { component, signal } from '@sigx/lynx';
import { Timeline, defineAnatomy, partAxes, partBag, provideCarriedAxes, provideVariantAxes, registerAxisDefaults, useVariantAxes } from '../src/index';
import { clearAxisDefaults } from '../src/contract/axis-defaults';
import { expectAnatomy, expectClassGrammar } from '../src/testing/index';

type Node = { props: Record<string, unknown>; children: Node[]; _class?: string };

const conforms = (container: never): void => {
    expectAnatomy(container, anatomies.timeline);
    expectClassGrammar(container, anatomies.timeline);
};

function partsOf(root: Node, part: string, scope = 'timeline', out: Node[] = []): Node[] {
    if (root.props['data-scope'] === scope && root.props['data-part'] === part) out.push(root);
    for (const child of root.children) partsOf(child, part, scope, out);
    return out;
}

afterEach(() => clearAxisDefaults());

describe('Timeline — the marker re-carries color', () => {
    const Probe = component<{ markerColor?: string }>(({ props }) => () => (
        <Timeline.Root color="neutral" size="sm">
            <Timeline.Item>
                <Timeline.Marker color={props.markerColor} />
                <Timeline.Content><text>first</text></Timeline.Content>
                <Timeline.Connector />
            </Timeline.Item>
            <Timeline.Item>
                <Timeline.Marker />
                <Timeline.Content placement="start"><text>second</text></Timeline.Content>
            </Timeline.Item>
        </Timeline.Root>
    ));

    it("a marker's own color beats the root's; its siblings keep the root's", () => {
        const { container } = render(<Probe markerColor="error" />);
        conforms(container as never);
        const [own, follower] = partsOf(container as never, 'marker');
        expect(own!.props['data-color']).toBe('error');
        expect(own!._class).toContain('zx-a-color-error');
        expect(own!._class).not.toContain('zx-a-color-neutral');
        // Other axes still come down from the root.
        expect(own!._class).toContain('zx-a-size-sm');
        expect(follower!.props['data-color']).toBe('neutral');
        expect(follower!._class).toContain('zx-a-color-neutral');
        for (const part of ['item', 'content', 'connector']) {
            for (const node of partsOf(container as never, part)) {
                expect(node._class).toContain('zx-a-color-neutral');
            }
        }
    });

    it('a marker without a color follows the root', () => {
        const { container } = render(<Probe />);
        conforms(container as never);
        for (const marker of partsOf(container as never, 'marker')) {
            expect(marker.props['data-color']).toBe('neutral');
            expect(marker._class).toContain('zx-a-color-neutral');
        }
    });

    it("follows the root's registered default when neither sets a color", () => {
        registerAxisDefaults({ timeline: { color: 'primary' } });
        const { container } = render(
            <Timeline.Root>
                <Timeline.Item><Timeline.Marker /></Timeline.Item>
                <Timeline.Item><Timeline.Marker color="success" /></Timeline.Item>
            </Timeline.Root>,
        );
        conforms(container as never);
        const [follower, own] = partsOf(container as never, 'marker');
        expect(follower!._class).toContain('zx-a-color-primary');
        expect(own!._class).toContain('zx-a-color-success');
    });

    it("tracks the marker's color reactively, falling back to the root's when cleared", async () => {
        const color = signal({ current: 'warning' as string | undefined });
        const Live = component(() => () => (
            <Timeline.Root color="info">
                <Timeline.Item><Timeline.Marker color={color.current} /></Timeline.Item>
            </Timeline.Root>
        ));
        const { container } = render(<Live />);
        const marker = () => partsOf(container as never, 'marker')[0]!;
        expect(marker()._class).toContain('zx-a-color-warning');
        await act(() => { color.current = undefined; });
        expect(marker()._class).toContain('zx-a-color-info');
        expect(marker()._class).not.toContain('zx-a-color-warning');
        conforms(container as never);
    });

    it('lays orientation and placement down as contract data', () => {
        const { container } = render(
            <Timeline.Root orientation="horizontal">
                <Timeline.Item>
                    <Timeline.Marker />
                    <Timeline.Content placement="start"><text>x</text></Timeline.Content>
                    <Timeline.Connector />
                </Timeline.Item>
            </Timeline.Root>,
        );
        conforms(container as never);
        expect(partsOf(container as never, 'content')[0]!.props['data-placement']).toBe('start');
        for (const part of ['root', 'item', 'content', 'connector']) {
            expect(partsOf(container as never, part)[0]!.props['data-orientation']).toBe('horizontal');
        }
        for (const part of ['marker', 'connector']) {
            expect(partsOf(container as never, part)[0]!.props['accessibility-element']).toBe(false);
        }
    });
});

// A synthetic anatomy with a part BELOW the re-carrying one: `item`
// re-carries color, `dot` lives inside it.
const probe = defineAnatomy('carries-probe', {
    root: { element: 'div' },
    item: { element: 'div', parent: 'root', carries: ['color'] },
    dot: { element: 'div', parent: 'item' },
});

describe('provideCarriedAxes', () => {
    const Root = component<{ color?: string; size?: string }>(({ props, slots }) => {
        const axes = () => ({ color: props.color, size: props.size });
        provideVariantAxes(axes);
        return () => <view {...partBag(probe, 'root', partAxes(axes()))}>{slots.default?.()}</view>;
    });
    const Item = component<{ color?: string; size?: string }>(({ props, slots }) => {
        // `size` is NOT declared carried: provideCarriedAxes must ignore it.
        const axes = provideCarriedAxes(probe, 'item', () => ({ color: props.color, size: props.size }));
        return () => <view {...partBag(probe, 'item', partAxes(axes()))}>{slots.default?.()}</view>;
    });
    const Dot = component(() => {
        const axes = useVariantAxes();
        return () => <view {...partBag(probe, 'dot', partAxes(axes()))} />;
    });

    it('a re-carrying part provides its own value to every part below it', () => {
        const { container } = render(
            <Root color="neutral" size="md">
                <Item color="error"><Dot /></Item>
                <Item><Dot /></Item>
            </Root>,
        );
        expect(() => expectAnatomy(container, probe)).not.toThrow();
        const [ownItem, followItem] = partsOf(container as never, 'item', probe.scope);
        const [ownDot, followDot] = partsOf(container as never, 'dot', probe.scope);
        expect(ownItem!.props['data-color']).toBe('error');
        expect(ownDot!.props['data-color']).toBe('error');
        expect(followItem!.props['data-color']).toBe('neutral');
        expect(followDot!.props['data-color']).toBe('neutral');
    });

    it('only the axes the anatomy declares are taken from the part', () => {
        const { container } = render(
            <Root color="neutral" size="md">
                <Item size="xl"><Dot /></Item>
            </Root>,
        );
        expect(partsOf(container as never, 'item', probe.scope)[0]!.props['data-size']).toBe('md');
        expect(partsOf(container as never, 'dot', probe.scope)[0]!.props['data-size']).toBe('md');
        expect(() => expectAnatomy(container, probe)).not.toThrow();
    });

    it('rejects a part the anatomy does not declare', () => {
        const Bogus = component(() => {
            provideCarriedAxes(probe, 'nope', () => ({}));
            return () => <view />;
        });
        expect(() => render(<Bogus />)).toThrow(/"carries-probe" has no part "nope"/);
    });
});

describe('expectAnatomy — the carries rule', () => {
    it('accepts a value below a re-carrying part that matches it, not the carrier', () => {
        const { container } = render(
            <view {...partBag(probe, 'root', { axes: { color: 'neutral' } })}>
                <view {...partBag(probe, 'item', { axes: { color: 'error' } })}>
                    <view {...partBag(probe, 'dot', { axes: { color: 'error' } })} />
                </view>
            </view>,
        );
        expect(() => expectAnatomy(container, probe)).not.toThrow();
    });

    it('fails a value below a re-carrying part that disagrees with it, naming the provider', () => {
        const { container } = render(
            <view {...partBag(probe, 'root', { axes: { color: 'neutral' } })}>
                <view {...partBag(probe, 'item', { axes: { color: 'error' } })}>
                    <view {...partBag(probe, 'dot', { axes: { color: 'neutral' } })} />
                </view>
            </view>,
        );
        expect(() => expectAnatomy(container, probe)).toThrow(
            /part "dot" renders data-color="neutral" but its nearest provider \("item", which carries "color"\) renders data-color="error"/,
        );
    });

    it('a re-carrying part without the attribute passes the carrier through', () => {
        const { container } = render(
            <view {...partBag(probe, 'root', { axes: { color: 'neutral' } })}>
                <view {...partBag(probe, 'item')}>
                    <view {...partBag(probe, 'dot', { axes: { color: 'neutral' } })} />
                </view>
            </view>,
        );
        expect(() => expectAnatomy(container, probe)).not.toThrow();
    });

    it('a part that does not carry an axis cannot supply its own value', () => {
        const { container } = render(
            <view {...partBag(probe, 'root', { axes: { size: 'md' } })}>
                <view {...partBag(probe, 'item', { axes: { size: 'xl' } })} />
            </view>,
        );
        expect(() => expectAnatomy(container, probe)).toThrow(
            /part "item" renders data-size="xl" but its carrier \("root"\) renders data-size="md"/,
        );
    });

    it('a re-carried axis is not a provider for an axis the part does not carry', () => {
        const { container } = render(
            <view {...partBag(probe, 'root', { axes: { size: 'md' } })}>
                <view {...partBag(probe, 'item', { axes: { size: 'md' } })}>
                    <view {...partBag(probe, 'dot', { axes: { size: 'xl' } })} />
                </view>
            </view>,
        );
        expect(() => expectAnatomy(container, probe)).toThrow(/part "dot" renders data-size="xl" but its carrier \("root"\)/);
    });

    it("the real Timeline marker's own value conforms", () => {
        const { container } = render(
            <view {...partBag(anatomies.timeline, 'root', { axes: { color: 'neutral' } })}>
                <view {...partBag(anatomies.timeline, 'item', { axes: { color: 'neutral' } })}>
                    <view {...partBag(anatomies.timeline, 'marker', { axes: { color: 'error' } })} />
                    <view {...partBag(anatomies.timeline, 'content', { placement: 'end', axes: { color: 'error' } })} />
                </view>
            </view>,
        );
        // content is the marker's SIBLING, so its provider is the root — the
        // marker's value does not reach it.
        expect(() => expectAnatomy(container, anatomies.timeline)).toThrow(
            /part "content" renders data-color="error" but its carrier \("root"\) renders data-color="neutral"/,
        );
    });
});
