import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { RichTextMethods, type SelectionState } from '@sigx/lynx-richtext';
import { EditorToolbar } from '../src/editor/toolbar/Toolbar';
import { defaultToolbarItems, type ToolbarItem } from '../src/editor/toolbar/items';
import { MarkdownEditor, type MarkdownEditorController } from '../src/editor/MarkdownEditor';

const spies = {
    toggleFormat: vi.spyOn(RichTextMethods, 'toggleFormat'),
    setBlockType: vi.spyOn(RichTextMethods, 'setBlockType'),
};
beforeEach(() => {
    for (const spy of Object.values(spies)) spy.mockClear().mockImplementation(() => {});
});
afterEach(() => {
    for (const spy of Object.values(spies)) spy.mockReset();
});

const sel = (overrides: Partial<SelectionState> = {}): SelectionState => ({
    start: 0,
    end: 4,
    activeFormats: [],
    activeBlock: 'paragraph',
    caretRect: { x: 0, y: 0, height: 16 },
    ...overrides,
});

describe('defaultToolbarItems', () => {
    it('covers the v1 controller surface', () => {
        expect(defaultToolbarItems.map((i) => i.id)).toEqual([
            'bold', 'italic', 'strike', 'code', 'h1', 'h2', 'paragraph',
        ]);
    });

    it('derives active states from the selection', () => {
        const by = Object.fromEntries(defaultToolbarItems.map((i) => [i.id, i]));
        expect(by['bold'].isActive!(sel({ activeFormats: ['bold'] }))).toBe(true);
        expect(by['bold'].isActive!(sel())).toBe(false);
        expect(by['h2'].isActive!(sel({ activeBlock: 'heading', headingLevel: 2 }))).toBe(true);
        expect(by['h1'].isActive!(sel({ activeBlock: 'heading', headingLevel: 2 }))).toBe(false);
        expect(by['paragraph'].isActive!(sel())).toBe(true);
        expect(by['bold'].isActive!(null)).toBe(false);
    });
});

describe('EditorToolbar', () => {
    it('renders one tappable per item and dispatches run(controller) on tap', () => {
        const run = vi.fn();
        const items: ToolbarItem[] = [
            { id: 'x', label: 'X', run },
            { id: 'y', label: 'Y', run: () => {} },
        ];
        const controller = { marker: true } as unknown as MarkdownEditorController;
        const { container } = render(
            <EditorToolbar items={items} controller={controller} />,
        );
        const texts = container.findAllByType('text').map((t) => t.textContent());
        expect(texts).toEqual(['X', 'Y']);

        const tappables = container
            .findAllByType('view')
            .filter((v) => v._handlers.has('bindtap'));
        expect(tappables).toHaveLength(2);
        tappables[0]._handlers.get('bindtap')!({});
        expect(run).toHaveBeenCalledWith({ controller });
    });

    it('does not dispatch without a controller', () => {
        const run = vi.fn();
        const { container } = render(
            <EditorToolbar items={[{ id: 'x', label: 'X', run }]} />,
        );
        const tappable = container
            .findAllByType('view')
            .find((v) => v._handlers.has('bindtap'))!;
        tappable._handlers.get('bindtap')!({});
        expect(run).not.toHaveBeenCalled();
    });

    it('renders accessibility metadata on default items', () => {
        const { container } = render(
            <EditorToolbar items={[{ id: 'bold', label: 'B', isActive: () => true, run: () => {} }]} />,
        );
        const item = container
            .findAllByType('view')
            .find((v) => v._handlers.has('bindtap'))!;
        expect(item.props['accessibility-element']).toBe(true);
        expect(item.props['accessibility-label']).toBe('B');
        expect(item.props['accessibility-trait']).toBe('button');
        expect(item.props['accessibility-status']).toBe('selected');
    });

    it('falls back to id for icon-only items (label optional)', () => {
        const { container } = render(
            <EditorToolbar items={[{ id: 'mention', icon: 'at-sign', run: () => {} }]} />,
        );
        expect(container.findByText('mention')).toBeTruthy();
        const item = container
            .findAllByType('view')
            .find((v) => v._handlers.has('bindtap'))!;
        expect(item.props['accessibility-label']).toBe('mention');
    });

    it('sets ignore-focus on the toolbar root', () => {
        const { container } = render(<EditorToolbar items={[]} />);
        const root = container
            .findAllByType('view')
            .find((v) => v.props['ignore-focus'] === true);
        expect(root).toBeTruthy();
    });

    it('renderItem fully replaces the default item rendering', () => {
        const { container } = render(
            <EditorToolbar
                items={[{ id: 'x', label: 'X', run: () => {} }]}
                renderItem={(item, _active, run) => (
                    <view key={item.id} class="custom-item" bindtap={run} />
                )}
            />,
        );
        expect(container.findAllByType('view').some((v) => v.props['class'] === 'custom-item')).toBe(true);
        expect(container.findAllByType('text')).toHaveLength(0);
    });
});

describe('MarkdownEditor built-in toolbar', () => {
    it('is absent by default and renders below the input with toolbar=true', () => {
        const off = render(<MarkdownEditor />);
        expect(off.container.findAllByType('view').some((v) => v.props['ignore-focus'] === true)).toBe(false);

        const { container } = render(<MarkdownEditor toolbar />);
        const root = container.findByType('view')!;
        const order = root.children.map((c: any) => c.type === 'sigx-richtext'
            ? 'input'
            : (c.props?.['ignore-focus'] ? 'toolbar' : c.type));
        expect(order.indexOf('input')).toBeLessThan(order.lastIndexOf('toolbar'));
    });

    it('dispatches default items through the editor controller', () => {
        const { container } = render(<MarkdownEditor toolbar />);
        const boldTap = container
            .findAllByType('view')
            .filter((v) => v._handlers.has('bindtap'))[0];
        boldTap._handlers.get('bindtap')!({});
        expect(spies.toggleFormat).toHaveBeenCalledWith(expect.anything(), 'bold');
    });
});
