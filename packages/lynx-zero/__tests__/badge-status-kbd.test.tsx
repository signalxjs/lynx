/**
 * Wave 3, display (W3A #1234, epic #1140): Badge, Status and Kbd on the zero
 * anatomy. Every rendered state is held to BOTH oracles (anatomy + class
 * grammar); the badge dot's re-carried colour follows Timeline's marker
 * contract (the nearest carrier wins, stamped on the part).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { component, signal } from '@sigx/lynx';
import { Badge, Kbd, Status, registerAxisDefaults } from '../src/index';
import { clearAxisDefaults } from '../src/contract/axis-defaults';
import { ForceStates, expectAnatomy, expectClassGrammar } from '../src/testing/index';

const conforms = (container: unknown, scope: 'badge' | 'status' | 'kbd'): void => {
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

afterEach(() => clearAxisDefaults());

describe('Badge', () => {
    it('is one pill part carrying the axes, the label as its child', () => {
        const { container } = render(<Badge color="success" size="lg" variant="soft"><text>Active</text></Badge>);
        const root = byPart(container, 'badge', 'root');
        expect(root.type).toBe('view');
        expect(root._class).toContain('zx-badge__root');
        expect(root._class).toContain('zx-a-color-success');
        expect(root._class).toContain('zx-a-size-lg');
        expect(root._class).toContain('zx-a-variant-soft');
        expect(root.props['data-color']).toBe('success');
        expect(root.children.some((c) => c.type === 'text')).toBe(true);
        // No name given: the reader reaches the text itself.
        expect(root.props['accessibility-element']).toBeUndefined();
        conforms(container, 'badge');
    });

    it('stamps nothing for an unset axis the skin gives no default', () => {
        const { container } = render(<Badge.Root><text>Tag</text></Badge.Root>);
        const root = byPart(container, 'badge', 'root');
        expect(root._class).toBe('zx-badge__root');
        conforms(container, 'badge');
    });

    it('resolves registered skin defaults onto the pill and its dot', () => {
        registerAxisDefaults({ badge: { size: 'sm' } });
        const { container } = render(<Badge.Root><Badge.Dot /><text>Tag</text></Badge.Root>);
        expect(byPart(container, 'badge', 'root')._class).toContain('zx-a-size-sm');
        expect(byPart(container, 'badge', 'dot')._class).toContain('zx-a-size-sm');
    });

    it('a label makes the pill one named element', () => {
        const { container } = render(<Badge label="3 unread"><text>3</text></Badge>);
        const root = byPart(container, 'badge', 'root');
        expect(root.props['accessibility-element']).toBe(true);
        expect(root.props['accessibility-label']).toBe('3 unread');
    });

    it('appends consumer classes last', () => {
        const { container } = render(<Badge class="mine" color="info"><text>x</text></Badge>);
        expect(byPart(container, 'badge', 'root')._class.endsWith(' mine')).toBe(true);
    });
});

describe('Badge.Dot — re-carries color, one state', () => {
    it('without a colour of its own it follows the pill (and the pill\'s other axes)', () => {
        const { container } = render(
            <Badge.Root color="primary" size="xs"><Badge.Dot /><text>Live</text></Badge.Root>,
        );
        const dot = byPart(container, 'badge', 'dot');
        expect(dot.props['data-color']).toBe('primary');
        expect(dot._class).toContain('zx-a-color-primary');
        expect(dot._class).toContain('zx-a-size-xs');
        conforms(container, 'badge');
    });

    it("its own colour beats the pill's, for itself only", () => {
        const { container } = render(
            <Badge.Root color="neutral"><Badge.Dot color="success" /><text>Online</text></Badge.Root>,
        );
        const dot = byPart(container, 'badge', 'dot');
        expect(dot.props['data-color']).toBe('success');
        expect(dot._class).toContain('zx-a-color-success');
        expect(dot._class).not.toContain('zx-a-color-neutral');
        expect(byPart(container, 'badge', 'root')._class).toContain('zx-a-color-neutral');
        conforms(container, 'badge');
    });

    it('on an uncoloured pill an uncoloured dot carries no colour (it is the ink)', () => {
        const { container } = render(<Badge.Root><Badge.Dot /><text>Idle</text></Badge.Root>);
        const dot = byPart(container, 'badge', 'dot');
        expect(dot.props['data-color']).toBeUndefined();
        expect(dot._class).toBe('zx-badge__dot');
        conforms(container, 'badge');
    });

    it('`running` stamps the state; absent at rest', async () => {
        const running = signal({ on: false });
        const Probe = component(() => () => (
            <Badge.Root color="warning"><Badge.Dot running={running.on} /><text>Deploying</text></Badge.Root>
        ));
        const { container } = render(<Probe />);
        let dot = byPart(container, 'badge', 'dot');
        expect(dot.props['data-state']).toBeUndefined();
        expect(dot._class).not.toContain('zx-s-running');
        conforms(container, 'badge');

        await act(() => { running.on = true; });
        dot = byPart(container, 'badge', 'dot');
        expect(dot.props['data-state']).toBe('running');
        expect(dot._class).toContain('zx-s-running');
        conforms(container, 'badge');
    });

    it('is decorative — never an accessible element', () => {
        const { container } = render(<Badge.Root><Badge.Dot color="error" /><text>Down</text></Badge.Root>);
        expect(byPart(container, 'badge', 'dot').props['accessibility-element']).toBe(false);
    });

    it('a colour change on the pill reaches a following dot', async () => {
        const color = signal({ value: 'info' });
        const Probe = component(() => () => (
            <Badge.Root color={color.value}><Badge.Dot /><text>x</text></Badge.Root>
        ));
        const { container } = render(<Probe />);
        expect(byPart(container, 'badge', 'dot')._class).toContain('zx-a-color-info');
        await act(() => { color.value = 'error'; });
        expect(byPart(container, 'badge', 'dot')._class).toContain('zx-a-color-error');
    });

    it('ForceStates leaves the flag-less badge untouched (the anatomy declares no flags)', () => {
        const { container } = render(
            <ForceStates flags={{ pressed: true, 'focus-visible': true }}>
                <Badge.Root color="primary"><Badge.Dot running /><text>x</text></Badge.Root>
            </ForceStates>,
        );
        expect(byPart(container, 'badge', 'root')._class).not.toContain('zx-f-');
        expect(byPart(container, 'badge', 'dot')._class).not.toContain('zx-f-');
        conforms(container, 'badge');
    });
});

describe('Status', () => {
    it('is one empty paint part carrying color and size', () => {
        const { container } = render(<Status color="success" size="sm" />);
        const root = byPart(container, 'status', 'root');
        expect(root.type).toBe('view');
        expect(root.children).toHaveLength(0);
        expect(root._class).toContain('zx-status__root');
        expect(root._class).toContain('zx-a-color-success');
        expect(root._class).toContain('zx-a-size-sm');
        conforms(container, 'status');
    });

    it('unlabelled, it decorates visible text: not an accessible element', () => {
        const { container } = render(<Status.Root color="error" />);
        const root = byPart(container, 'status', 'root');
        expect(root.props['accessibility-element']).toBe(false);
        expect(root.props['accessibility-label']).toBeUndefined();
    });

    it('labelled, it IS the content: an image named by the label', () => {
        const { container } = render(<Status color="error" label="Service degraded" />);
        const root = byPart(container, 'status', 'root');
        expect(root.props['accessibility-element']).toBe(true);
        expect(root.props['accessibility-trait']).toBe('image');
        expect(root.props['accessibility-label']).toBe('Service degraded');
        // Never a live region / state: a static dot has nothing to announce.
        expect(root.props['accessibility-status']).toBeUndefined();
        conforms(container, 'status');
    });

    it('stamps no colour for an unset axis (the skin paints base-content)', () => {
        const { container } = render(<Status />);
        expect(byPart(container, 'status', 'root')._class).toBe('zx-status__root');
    });
});

describe('Kbd', () => {
    it('is one keycap part carrying the axes, the glyph as its child', () => {
        const { container } = render(<Kbd color="neutral" size="xl"><text>K</text></Kbd>);
        const root = byPart(container, 'kbd', 'root');
        expect(root.type).toBe('view');
        expect(root._class).toContain('zx-kbd__root');
        expect(root._class).toContain('zx-a-color-neutral');
        expect(root._class).toContain('zx-a-size-xl');
        expect(root.children.some((c) => c.type === 'text')).toBe(true);
        expect(root.props['accessibility-element']).toBeUndefined();
        conforms(container, 'kbd');
    });

    it('a label names a glyph that reads badly aloud', () => {
        const { container } = render(<Kbd.Root label="Command"><text>⌘</text></Kbd.Root>);
        const root = byPart(container, 'kbd', 'root');
        expect(root.props['accessibility-element']).toBe(true);
        expect(root.props['accessibility-label']).toBe('Command');
        conforms(container, 'kbd');
    });
});
