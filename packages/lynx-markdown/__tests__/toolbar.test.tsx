/**
 * The Lynx toolbar over the core's item contract: active / enabled states
 * from `toolbarState`, taps run commands through the editor, `renderItem`
 * re-skins, and the built-in placement in `<MarkdownEditor>`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitForUpdate, type TestNode } from '@sigx/lynx-testing';
import { defaultToolbarItems, type ToolbarItem } from '@sigx/richtext/editor';
import { EditorToolbar } from '../src/editor/toolbar/Toolbar';
import { installFakeElement, mountEditor, resetFakeElement, tapAt } from './editor/harness';

beforeEach(installFakeElement);
afterEach(resetFakeElement);

const tappable = (root: TestNode, label: string): TestNode =>
    root.findAllByType('view').find((v) => v._handlers.has('bindtap') && v.findByText(label))!;

describe('defaultToolbarItems (the core set)', () => {
    it('is the shared neutral set with groups', () => {
        const ids = defaultToolbarItems.map((i) => i.id);
        for (const id of ['bold', 'italic', 'strike', 'code', 'link', 'h1', 'h2', 'h3', 'paragraph', 'quote', 'codeBlock', 'hr', 'table', 'undo', 'redo']) {
            expect(ids).toContain(id);
        }
        expect(new Set(defaultToolbarItems.map((i) => i.group))).toEqual(new Set(['inline', 'block', 'insert', 'history']));
    });
});

describe('EditorToolbar', () => {
    it('renders one tappable per item and runs the command through the controller', async () => {
        const m = await mountEditor({ value: 'hello' });
        tapAt(m.field(0), 0, 5);
        const { container } = render(<EditorToolbar controller={m.controller} />);
        expect(container.findAllByType('view').filter((v) => v._handlers.has('bindtap')).length).toBeGreaterThanOrEqual(defaultToolbarItems.length);
        fireEvent.tap(tappable(container, 'B'));
        await waitForUpdate();
        expect(m.controller.getMarkdown()).toBe('**hello**\n');
        // Active state follows the editor state.
        const bold = tappable(container, 'B');
        expect(bold.props['accessibility-status']).toBe('selected');
    });

    it('does not dispatch without a controller and disables items the state refuses', async () => {
        const { container } = render(<EditorToolbar controller={null} />);
        expect(() => fireEvent.tap(tappable(container, 'B'))).not.toThrow();
        // Inline marks need a text selection: on a block selection they are disabled.
        const m = await mountEditor({ value: 'a' });
        tapAt(m.field(0), 0);
        m.controller.run('escapeToBlockSelection');
        await waitForUpdate();
        const bar = render(<EditorToolbar controller={m.controller} />).container;
        const bold = tappable(bar, 'B');
        expect((bold.props['style'] as { opacity?: number }).opacity).toBe(0.4);
        fireEvent.tap(bold);
        await waitForUpdate();
        expect(m.controller.getMarkdown()).toBe('a');
    });

    it('renders accessibility metadata and sets ignore-focus on the root', async () => {
        const m = await mountEditor({ value: 'a' });
        const { container } = render(<EditorToolbar controller={m.controller} />);
        const root = container.findAllByType('view')[0];
        expect(root.props['ignore-focus']).toBe(true);
        const bold = tappable(container, 'B');
        expect(bold.props['accessibility-element']).toBe(true);
        expect(bold.props['accessibility-label']).toBe('B');
        expect(bold.props['accessibility-trait']).toBe('button');
    });

    it('renderItem fully replaces the default item rendering and receives the enabled flag', async () => {
        const m = await mountEditor({ value: 'a' });
        tapAt(m.field(0), 0);
        const seen: string[] = [];
        const { container } = render(
            <EditorToolbar
                controller={m.controller}
                items={[{ id: 'x', label: 'X', run: () => {} } satisfies ToolbarItem]}
                renderItem={(item, active, run, enabled) => {
                    seen.push(`${item.id}:${active}:${enabled}`);
                    return <text bindtap={run}>{`custom-${item.id}`}</text>;
                }}
            />,
        );
        expect(container.findByText('custom-x')).toBeTruthy();
        expect(seen).toContain('x:false:true');
    });
});

describe('MarkdownEditor built-in toolbar', () => {
    it('is absent by default and renders with toolbar=true; taps format the caret block', async () => {
        const none = await mountEditor({ value: 'a' });
        expect(none.container.findAllByType('view').some((v) => v.props['ignore-focus'] === true && v.findByText('B'))).toBe(false);
        const m = await mountEditor({ value: 'a', toolbar: true });
        tapAt(m.field(0), 0);
        fireEvent.tap(tappable(m.container, 'H1'));
        await waitForUpdate();
        expect(m.controller.getMarkdown()).toBe('# a\n');
    });

    it('a custom item set replaces the base set (plugin items still append)', async () => {
        const run = vi.fn();
        const m = await mountEditor({ value: 'a', toolbar: 'top', toolbarItems: [{ id: 'only', label: 'ONLY', run }] });
        expect(m.container.findByText('ONLY')).toBeTruthy();
        expect(m.container.findAllByType('view').some((v) => v._handlers.has('bindtap') && v.findByText('B'))).toBe(false);
    });
});
