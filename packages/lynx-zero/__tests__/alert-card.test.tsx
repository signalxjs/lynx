/**
 * Wave 3 (#1235, epic #1140): Alert and Card on the zero anatomy. Every
 * rendered state is held to BOTH oracles (anatomy + class grammar), forced
 * states included.
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, touch } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { component, signal } from '@sigx/lynx';
import { Alert, Card } from '../src/index';
import { cardBandEnds } from '../src/components/card/Card';
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

const press = async (node: TestNode): Promise<void> => {
    await act(() => fireEvent.touchStart(node as never, { touches: [touch(1, 1)] }));
    await act(() => fireEvent.touchEnd(node as never));
    await act(() => fireEvent.tap(node as never));
};

describe('Alert', () => {
    const full = (extra: Record<string, unknown> = {}) => (
        <Alert.Root color="warning" size="sm" {...extra}>
            <Alert.Icon><text>!</text></Alert.Icon>
            <Alert.Title>Quota</Alert.Title>
            <Alert.Description>92% used.</Alert.Description>
            <Alert.Close />
        </Alert.Root>
    );

    it('renders every part open, with the axes pushed down to each', () => {
        const { container } = render(full());
        const root = byPart(container, 'alert', 'root');
        expect(root.props['data-state']).toBe('open');
        expect(root._class).toContain('zx-s-open');
        for (const part of ['root', 'icon', 'title', 'description', 'close']) {
            const node = byPart(container, 'alert', part);
            expect(node._class).toContain('zx-a-color-warning');
            expect(node._class).toContain('zx-a-size-sm');
        }
        // Title / Description are text; the root is no accessible element
        // (that would hide its text from the reader on iOS).
        expect(byPart(container, 'alert', 'title').type).toBe('text');
        expect(byPart(container, 'alert', 'description').type).toBe('text');
        expect(root.props['accessibility-element']).toBeUndefined();
        conforms(container, 'alert');
    });

    it('the icon is decoration, out of the accessibility tree', () => {
        const { container } = render(full());
        expect(byPart(container, 'alert', 'icon').props['accessibility-element']).toBe(false);
    });

    it('close is a button named "Close" (label overrides) and draws × by default', () => {
        const { container } = render(full());
        const close = byPart(container, 'alert', 'close');
        expect(close.props['accessibility-trait']).toBe('button');
        expect(close.props['accessibility-label']).toBe('Close');
        const glyph = close.children[0]!;
        expect(glyph.type).toBe('text');

        const labelled = render(<Alert.Root><Alert.Close label="Dismiss"><text>x</text></Alert.Close></Alert.Root>);
        expect(byPart(labelled.container, 'alert', 'close').props['accessibility-label']).toBe('Dismiss');
    });

    it('stamps with-icon / with-close on the text parts from what is rendered', async () => {
        const { container } = render(full());
        for (const part of ['title', 'description']) {
            const node = byPart(container, 'alert', part);
            expect(node._class).toContain('zx-m-with-icon');
            expect(node._class).toContain('zx-m-with-close');
            expect(node.props['data-mod-with-icon']).toBe('');
        }
        const bare = render(
            <Alert.Root><Alert.Title>Plain</Alert.Title><Alert.Description>Text.</Alert.Description></Alert.Root>,
        );
        for (const part of ['title', 'description']) {
            const node = byPart(bare.container, 'alert', part);
            expect(node._class).not.toContain('zx-m-with-icon');
            expect(node._class).not.toContain('zx-m-with-close');
        }
        conforms(bare.container, 'alert');

        // Presence follows a conditional part in and out.
        const state = signal({ icon: true });
        const Host = component(() => () => (
            <Alert.Root>
                {state.icon ? <Alert.Icon><text>i</text></Alert.Icon> : null}
                <Alert.Title>T</Alert.Title>
            </Alert.Root>
        ));
        const toggled = render(<Host />);
        expect(byPart(toggled.container, 'alert', 'title')._class).toContain('zx-m-with-icon');
        await act(() => { state.icon = false; });
        expect(byPart(toggled.container, 'alert', 'title')._class).not.toContain('zx-m-with-icon');
    });

    it('close dismisses: the root unmounts (hiddenIn closed) and openChange fires', async () => {
        const changes: boolean[] = [];
        const { container } = render(full({ onOpenChange: (v: boolean) => changes.push(v) }));
        await press(byPart(container, 'alert', 'close'));
        expect(changes).toEqual([false]);
        expect(allParts(container, 'alert', 'root')).toHaveLength(0);
    });

    it('controlled: follows the model and writes through it', async () => {
        const state = signal({ open: false });
        const { container } = render(
            <Alert.Root model={() => state.open}><Alert.Title>T</Alert.Title><Alert.Close /></Alert.Root>,
        );
        expect(allParts(container, 'alert', 'root')).toHaveLength(0);
        await act(() => { state.open = true; });
        expect(byPart(container, 'alert', 'root').props['data-state']).toBe('open');
        await press(byPart(container, 'alert', 'close'));
        expect(state.open).toBe(false);
        expect(allParts(container, 'alert', 'root')).toHaveLength(0);
    });

    it('defaultOpen={false} starts closed', () => {
        const { container } = render(<Alert.Root defaultOpen={false}><Alert.Title>T</Alert.Title></Alert.Root>);
        expect(allParts(container, 'alert', 'root')).toHaveLength(0);
    });

    it('the pressed flag lights on touch and clears on release', async () => {
        const { container } = render(full());
        const close = byPart(container, 'alert', 'close');
        await act(() => fireEvent.touchStart(close as never, { touches: [touch(1, 1)] }));
        const held = byPart(container, 'alert', 'close');
        expect(held._class).toContain('zx-f-pressed');
        expect(held.props['data-pressed']).toBe('');
        conforms(container, 'alert');
        await act(() => fireEvent.touchEnd(close as never));
        expect(byPart(container, 'alert', 'close')._class).not.toContain('zx-f-pressed');
    });

    it('a disabled close neither presses nor closes, and is announced disabled', async () => {
        const changes: boolean[] = [];
        const { container } = render(
            <Alert.Root onOpenChange={(v: boolean) => changes.push(v)}>
                <Alert.Title>T</Alert.Title>
                <Alert.Close disabled />
            </Alert.Root>,
        );
        const close = byPart(container, 'alert', 'close');
        await act(() => fireEvent.touchStart(close as never, { touches: [touch(1, 1)] }));
        expect(byPart(container, 'alert', 'close')._class).not.toContain('zx-f-pressed');
        await act(() => fireEvent.touchEnd(close as never));
        await act(() => fireEvent.tap(close as never));
        expect(changes).toEqual([]);
        expect(close._class).toContain('zx-f-disabled');
        expect(close.props['accessibility-status']).toBe('disabled');
        conforms(container, 'alert');
    });

    it('ForceStates: pressed + focus-visible land on the close only, and conform', () => {
        const { container } = render(<ForceStates flags={{ pressed: true, 'focus-visible': true }}>{full()}</ForceStates>);
        const close = byPart(container, 'alert', 'close');
        expect(close._class).toContain('zx-f-pressed');
        expect(close._class).toContain('zx-f-focus-visible');
        expect(byPart(container, 'alert', 'root')._class).not.toContain('zx-f-pressed');
        conforms(container, 'alert');
    });
});

describe('Card', () => {
    it('cardBandEnds: the first and last of the mount order', () => {
        expect(cardBandEnds([], 1)).toEqual({ first: false, last: false });
        expect(cardBandEnds([1], 1)).toEqual({ first: true, last: true });
        expect(cardBandEnds([1, 2, 3], 1)).toEqual({ first: true, last: false });
        expect(cardBandEnds([1, 2, 3], 3)).toEqual({ first: false, last: true });
        expect(cardBandEnds([1, 2, 3], 2)).toEqual({ first: false, last: false });
    });

    it('renders every part, with the axes pushed down, and conforms', () => {
        const { container } = render(
            <Card.Root color="primary" size="lg">
                <Card.Media><view /></Card.Media>
                <Card.Header>
                    <Card.Title>Report</Card.Title>
                    <Card.Description>Updated now</Card.Description>
                </Card.Header>
                <Card.Body><text>Body</text></Card.Body>
                <Card.Footer><text>Foot</text></Card.Footer>
            </Card.Root>,
        );
        for (const part of ['root', 'media', 'header', 'title', 'description', 'body', 'footer']) {
            const node = byPart(container, 'card', part);
            expect(node._class).toContain('zx-a-color-primary');
            expect(node._class).toContain('zx-a-size-lg');
        }
        const title = byPart(container, 'card', 'title');
        expect(title.type).toBe('text');
        expect(title.props['accessibility-trait']).toBe('header');
        expect(byPart(container, 'card', 'description').type).toBe('text');
        conforms(container, 'card');
    });

    it('media at the top is stamped first; at the bottom, last', () => {
        const top = render(
            <Card.Root>
                <Card.Media><view /></Card.Media>
                <Card.Body><text>B</text></Card.Body>
            </Card.Root>,
        );
        const media = byPart(top.container, 'card', 'media');
        expect(media._class).toContain('zx-m-first');
        expect(media._class).not.toContain('zx-m-last');
        expect(media.props['data-mod-first']).toBe('');
        conforms(top.container, 'card');

        const bottom = render(
            <Card.Root>
                <Card.Body><text>B</text></Card.Body>
                <Card.Media><view /></Card.Media>
            </Card.Root>,
        );
        const low = byPart(bottom.container, 'card', 'media');
        expect(low._class).toContain('zx-m-last');
        expect(low._class).not.toContain('zx-m-first');

        const only = render(<Card.Root><Card.Media><view /></Card.Media></Card.Root>);
        const alone = byPart(only.container, 'card', 'media');
        expect(alone._class).toContain('zx-m-first');
        expect(alone._class).toContain('zx-m-last');
    });

    it('a band unmounting moves the end onto the media band', async () => {
        const state = signal({ body: true });
        const Host = component(() => () => (
            <Card.Root>
                <Card.Media><view /></Card.Media>
                {state.body ? <Card.Body><text>B</text></Card.Body> : null}
            </Card.Root>
        ));
        const { container } = render(<Host />);
        expect(byPart(container, 'card', 'media')._class).not.toContain('zx-m-last');
        await act(() => { state.body = false; });
        expect(byPart(container, 'card', 'media')._class).toContain('zx-m-last');
    });

    it('a bare card (root + body) conforms', () => {
        const { container } = render(<Card.Root><Card.Body><text>Just a body</text></Card.Body></Card.Root>);
        expect(byPart(container, 'card', 'body')._class).toContain('zx-card__body');
        conforms(container, 'card');
    });
});
