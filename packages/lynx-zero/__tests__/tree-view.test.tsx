/**
 * Zero wave 4, navigation (W4D, #1256): TreeView held to BOTH oracles
 * (anatomy + class grammar), plus the lynx wiring — tap to select / expand,
 * multiple as a tap toggle, the tri-state check model, disabled nodes, the
 * collapsed subtree kept mounted (`hidden` + a clipped, invisible 0×0 box —
 * not display none, #1271), forced states.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, touch } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { signal } from '@sigx/lynx';
import { TreeView } from '../src/index';
import { clearAxisDefaults } from '../src/contract/axis-defaults';
import { CLOSED_CONTENT_STYLE, OPEN_CONTENT_STYLE } from '../src/components/tree-view/TreeView';
import { createTreeRegistry, nodeCheckMark, treeSelectNext, treeSelection } from '../src/components/tree-view/TreeView';
import { ForceStates, expectAnatomy, expectClassGrammar } from '../src/testing/index';

type Node = { type?: string; props: Record<string, unknown>; children: Node[]; _class?: string; _style?: Record<string, unknown>; _handlers: Map<string, (e: unknown) => void> };

const conforms = (container: unknown): void => {
    expectAnatomy(container as never, anatomies['tree-view']);
    expectClassGrammar(container as never, anatomies['tree-view']);
};

function partsOf(root: Node, part: string, out: Node[] = []): Node[] {
    if (root.props['data-scope'] === 'tree-view' && root.props['data-part'] === part) out.push(root);
    for (const child of root.children) partsOf(child, part, out);
    return out;
}

const classOf = (node: Node): string[] => String(node._class ?? node.props['class'] ?? '').split(/\s+/);

/** The row of node `label`: the item or branch-trigger whose own text is it (marks excluded). */
function row(container: unknown, label: string): Node {
    const rows = [...partsOf(container as Node, 'item'), ...partsOf(container as Node, 'branch-trigger')];
    const found = rows.find((n) => n.children.some((c) => c.type === 'text' && c.props['data-part'] === undefined
        && (c as unknown as { textContent(): string }).textContent() === label));
    if (!found) throw new Error(`no row for ${label}`);
    return found;
}

function fire(node: Node, key: string): void {
    const handler = node._handlers.get(key);
    if (!handler) throw new Error(`no ${key} handler`);
    handler({ type: 'tap', detail: {} });
}

const tap = (node: Node): Promise<void> => act(() => fireEvent.tap(node as never));

/**
 * A small file tree:
 *   src/            (branch)
 *     index.ts
 *     lib/          (branch)
 *       a.ts
 *       b.ts        (disabled when `bDisabled`)
 *   README.md
 */
function Files(props: {
    root?: Record<string, unknown>;
    bDisabled?: boolean;
    srcDisabled?: boolean;
    checkbox?: boolean;
    libLoading?: boolean;
}) {
    const box = props.checkbox ? <TreeView.NodeCheckbox /> : null;
    const Root = TreeView.Root as unknown as (p: Record<string, unknown>) => JSX.Element;
    return (
        <Root {...props.root}>
            <TreeView.Label>Files</TreeView.Label>
            <TreeView.Tree>
                <TreeView.Branch value="src" disabled={props.srcDisabled}>
                    <TreeView.BranchTrigger>{box}<TreeView.BranchIndicator /><text>src</text></TreeView.BranchTrigger>
                    <TreeView.BranchContent>
                        <TreeView.Item value="src/index.ts">{box}<text>index.ts</text></TreeView.Item>
                        <TreeView.Branch value="lib" loading={props.libLoading}>
                            <TreeView.BranchTrigger>{box}<TreeView.BranchIndicator /><text>lib</text></TreeView.BranchTrigger>
                            <TreeView.BranchContent>
                                <TreeView.Item value="a.ts">{box}<text>a.ts</text></TreeView.Item>
                                <TreeView.Item value="b.ts" disabled={props.bDisabled}>{box}<text>b.ts</text></TreeView.Item>
                            </TreeView.BranchContent>
                        </TreeView.Branch>
                    </TreeView.BranchContent>
                </TreeView.Branch>
                <TreeView.Item value="README.md">{box}<text>README.md</text></TreeView.Item>
            </TreeView.Tree>
        </Root>
    );
}

afterEach(() => clearAxisDefaults());

describe('TreeView pure helpers', () => {
    it('reads the selection under either model shape', () => {
        expect(treeSelection('')).toEqual([]);
        expect(treeSelection('a')).toEqual(['a']);
        expect(treeSelection(['a', 'b', 'a'])).toEqual(['a', 'b']);
    });

    it('a tap selects alone in single mode and toggles under multiple', () => {
        expect(treeSelectNext(['a'], 'b', false)).toBe('b');
        expect(treeSelectNext(['a'], 'b', true)).toEqual(['a', 'b']);
        expect(treeSelectNext(['a', 'b'], 'a', true)).toEqual(['b']);
    });

    it('draws a mark only for checked and indeterminate', () => {
        expect(nodeCheckMark('checked')).toBe('✓');
        expect(nodeCheckMark('indeterminate')).toBe('−');
        expect(nodeCheckMark('unchecked')).toBeNull();
    });

    it('the registry finds leaves at any depth, and forgets an unregistered node', () => {
        const reg = createTreeRegistry();
        const off = () => false;
        reg.register({ value: 'src', parentValue: null, isBranch: true, disabled: off });
        reg.register({ value: 'lib', parentValue: 'src', isBranch: true, disabled: off });
        const leave = reg.register({ value: 'a', parentValue: 'lib', isBranch: false, disabled: off });
        reg.register({ value: 'i', parentValue: 'src', isBranch: false, disabled: off });
        expect(reg.leavesOf('src').map((n) => n.value).sort()).toEqual(['a', 'i']);
        expect(reg.leavesOf('lib').map((n) => n.value)).toEqual(['a']);
        // Memoized per registry version: a second read reuses the list.
        expect(reg.leavesOf('src')).toBe(reg.leavesOf('src'));
        leave();
        expect(reg.find('a')).toBeUndefined();
        expect(reg.leavesOf('src').map((n) => n.value)).toEqual(['i']);
    });
});

describe('TreeView', () => {
    it('renders the anatomy, collapsed by default: closed content stays mounted but hidden', () => {
        const { container } = render(<Files root={{ color: 'secondary', size: 'lg' }} />);
        conforms(container);
        const root = partsOf(container as never, 'root')[0]!;
        expect(classOf(root)).toEqual(expect.arrayContaining(['zx-tree-view__root', 'zx-a-color-secondary', 'zx-a-size-lg']));
        const label = partsOf(container as never, 'label')[0]!;
        expect(label.type).toBe('text');
        const content = partsOf(container as never, 'branch-content')[0]!;
        expect(content.props['data-state']).toBe('closed');
        expect(content.props['hidden']).toBe(true);
        expect(content.props['accessibility-elements-hidden']).toBe(true);
        expect(content.props['flatten']).toBe(false);
        // #1271: never display none (lynx keeps painting its text) — a
        // clipped, transparent, invisible 0×0 box out of flow instead.
        expect(content._style ?? content.props['style']).toEqual(CLOSED_CONTENT_STYLE);
        expect(CLOSED_CONTENT_STYLE).toMatchObject({
            display: 'flex', position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0, visibility: 'hidden',
        });
        // Kept mounted: the nested items are in the tree.
        expect(partsOf(container as never, 'item')).toHaveLength(4);
        const indicator = partsOf(container as never, 'branch-indicator')[0]!;
        expect(indicator.type).toBe('text');
        expect(indicator.props['data-state']).toBe('closed');
        expect(indicator.props['accessibility-element']).toBe(false);
        // Every part stamps the carrier's axes (push-down).
        for (const part of ['item', 'branch', 'branch-trigger', 'branch-indicator', 'branch-content', 'tree', 'label']) {
            expect(classOf(partsOf(container as never, part)[0]!), part).toContain('zx-a-color-secondary');
        }
    });

    it('a tap on a branch row selects and expands it; a second tap collapses', async () => {
        const selected: string[] = [];
        const expanded: string[][] = [];
        const { container } = render(
            <Files root={{ onValueChange: (v: string) => selected.push(v), onExpandedValuesChange: (v: string[]) => expanded.push(v) }} />,
        );
        await tap(row(container, 'src'));
        conforms(container);
        expect(selected).toEqual(['src']);
        expect(expanded).toEqual([['src']]);
        const trigger = row(container, 'src');
        expect(trigger.props['data-state']).toBe('open');
        expect(classOf(trigger)).toEqual(expect.arrayContaining(['zx-s-open', 'zx-f-selected']));
        expect(trigger.props['accessibility-status']).toBe('selected, expanded');
        const content = partsOf(container as never, 'branch-content')[0]!;
        expect(content.props['data-state']).toBe('open');
        expect(content.props['hidden']).toBeUndefined();
        expect(content.props['accessibility-elements-hidden']).toBeUndefined();
        expect(content._style ?? content.props['style']).toEqual(OPEN_CONTENT_STYLE);
        expect(partsOf(container as never, 'branch-indicator')[0]!.props['data-state']).toBe('open');
        await tap(row(container, 'src'));
        expect(expanded.at(-1)).toEqual([]);
        expect(row(container, 'src').props['data-state']).toBe('closed');
        // A live collapse takes the same hidden box as a closed mount (#1271).
        const folded = partsOf(container as never, 'branch-content')[0]!;
        expect(folded.props['hidden']).toBe(true);
        expect(folded._style ?? folded.props['style']).toEqual(CLOSED_CONTENT_STYLE);
    });

    it('a tap on a leaf selects it alone in single mode (bound model)', async () => {
        const state = signal({ v: 'README.md' });
        const { container } = render(
            <TreeView.Root model={() => state.v} defaultExpandedValues={['src']}>
                <TreeView.Tree>
                    <TreeView.Branch value="src">
                        <TreeView.BranchTrigger><text>src</text></TreeView.BranchTrigger>
                        <TreeView.BranchContent>
                            <TreeView.Item value="src/index.ts"><text>index.ts</text></TreeView.Item>
                        </TreeView.BranchContent>
                    </TreeView.Branch>
                    <TreeView.Item value="README.md"><text>README.md</text></TreeView.Item>
                </TreeView.Tree>
            </TreeView.Root>,
        );
        expect(classOf(row(container, 'README.md'))).toContain('zx-f-selected');
        await tap(row(container, 'index.ts'));
        expect(state.v).toBe('src/index.ts');
        expect(classOf(row(container, 'README.md'))).not.toContain('zx-f-selected');
        expect(row(container, 'index.ts').props['data-selected']).toBe('');
        expect(row(container, 'index.ts').props['accessibility-status']).toBe('selected');
        conforms(container);
    });

    it('under multiple a tap toggles the node in or out', async () => {
        const changes: string[][] = [];
        const { container } = render(
            <Files root={{ multiple: true, defaultValue: ['README.md'], defaultExpandedValues: ['src'], onValueChange: (v: string[]) => changes.push(v) }} />,
        );
        await tap(row(container, 'index.ts'));
        expect(changes.at(-1)).toEqual(['README.md', 'src/index.ts']);
        await tap(row(container, 'README.md'));
        expect(changes.at(-1)).toEqual(['src/index.ts']);
    });

    it('expandOnClick={false}: the row only selects, the indicator catches the toggle', async () => {
        const { container } = render(<Files root={{ expandOnClick: false }} />);
        await tap(row(container, 'src'));
        expect(row(container, 'src').props['data-state']).toBe('closed');
        expect(classOf(row(container, 'src'))).toContain('zx-f-selected');
        const indicator = partsOf(container as never, 'branch-indicator')[0]!;
        await act(() => fire(indicator, 'catchtap'));
        expect(row(container, 'src').props['data-state']).toBe('open');
    });

    it('with expandOnClick on, the indicator does not catch the tap (the row gets it)', () => {
        const { container } = render(<Files />);
        const indicator = partsOf(container as never, 'branch-indicator')[0]!;
        expect(indicator._handlers.get('catchtap')).toBeUndefined();
    });

    it('a disabled node is announced, refuses taps, and shows no press', async () => {
        const changes: unknown[] = [];
        const { container } = render(
            <Files bDisabled srcDisabled root={{ defaultExpandedValues: ['src', 'lib'], onValueChange: (v: string) => changes.push(v) }} />,
        );
        conforms(container);
        const b = row(container, 'b.ts');
        expect(classOf(b)).toContain('zx-f-disabled');
        expect(b.props['accessibility-status']).toBe('disabled');
        await act(() => fireEvent.touchStart(b as never, { touches: [touch(1, 1)] }));
        expect(classOf(row(container, 'b.ts'))).not.toContain('zx-f-pressed');
        await act(() => fireEvent.touchEnd(b as never));
        await tap(b);
        // A disabled branch neither selects nor folds.
        await tap(row(container, 'src'));
        expect(changes).toEqual([]);
        expect(row(container, 'src').props['data-state']).toBe('open');
        expect(partsOf(container as never, 'branch')[0]!.props['data-disabled']).toBe('');
        // Its enabled descendants stay live.
        await tap(row(container, 'a.ts'));
        expect(changes).toEqual(['a.ts']);
    });

    it('the root disabled flag disables every node', async () => {
        const changes: unknown[] = [];
        const { container } = render(<Files root={{ disabled: true, onValueChange: (v: string) => changes.push(v) }} />);
        conforms(container);
        expect(classOf(partsOf(container as never, 'root')[0]!)).toContain('zx-f-disabled');
        await tap(row(container, 'README.md'));
        await tap(row(container, 'src'));
        expect(changes).toEqual([]);
        expect(row(container, 'src').props['data-state']).toBe('closed');
        for (const item of partsOf(container as never, 'item')) expect(classOf(item)).toContain('zx-f-disabled');
    });

    it('press paints the pressed flag on the touched row only (tier 1: no main-thread scale)', async () => {
        const { container } = render(<Files />);
        const readme = row(container, 'README.md');
        await act(() => fireEvent.touchStart(readme as never, { touches: [touch(1, 1)] }));
        expect(classOf(row(container, 'README.md'))).toContain('zx-f-pressed');
        expect(classOf(row(container, 'src'))).not.toContain('zx-f-pressed');
        conforms(container);
        await act(() => fireEvent.touchEnd(readme as never));
        expect(classOf(row(container, 'README.md'))).not.toContain('zx-f-pressed');
    });

    it('loading reaches the indicator whatever the expansion, and the content only while open', async () => {
        const { container } = render(<Files libLoading root={{ defaultExpandedValues: ['src'] }} />);
        conforms(container);
        const lib = partsOf(container as never, 'branch')[1]!;
        expect(partsOf(lib, 'branch-indicator')[0]!.props['data-state']).toBe('loading');
        expect(partsOf(lib, 'branch-content')[0]!.props['data-state']).toBe('closed');
        await tap(row(container, 'lib'));
        expect(partsOf(lib, 'branch-content')[0]!.props['data-state']).toBe('loading');
        conforms(container);
    });

    it('forced states land on the rows that declare them and keep both oracles', () => {
        const { container } = render(
            <ForceStates flags={{ pressed: true, 'focus-visible': true }}>
                <Files />
            </ForceStates>,
        );
        conforms(container);
        expect(classOf(row(container, 'README.md'))).toEqual(expect.arrayContaining(['zx-f-pressed', 'zx-f-focus-visible']));
        expect(classOf(row(container, 'src'))).toEqual(expect.arrayContaining(['zx-f-pressed', 'zx-f-focus-visible']));
        // The branch wrapper declares neither.
        expect(classOf(partsOf(container as never, 'branch')[0]!)).not.toContain('zx-f-pressed');
    });

    it('refuses the empty-string sentinel in single mode', () => {
        expect(() => render(
            <TreeView.Root>
                <TreeView.Tree><TreeView.Item value=""><text>x</text></TreeView.Item></TreeView.Tree>
            </TreeView.Root>,
        )).toThrow(/reserved for "nothing selected"/);
    });
});

describe('TreeView checkable', () => {
    it('derives the branch tri-state from its enabled leaves, even while collapsed', () => {
        const { container } = render(<Files checkbox root={{ defaultCheckedValues: ['a.ts'] }} />);
        conforms(container);
        const box = (label: string) => partsOf(row(container, label), 'node-checkbox')[0]!;
        expect(box('a.ts').props['data-state']).toBe('checked');
        expect(box('b.ts').props['data-state']).toBe('unchecked');
        expect(box('lib').props['data-state']).toBe('indeterminate');
        expect(box('src').props['data-state']).toBe('indeterminate');
        expect(box('README.md').props['data-state']).toBe('unchecked');
        // Collapsed the whole time: the leaves stayed registered.
        expect(row(container, 'src').props['data-state']).toBe('closed');
    });

    it('checks every enabled descendant leaf from a branch box, leaving a disabled leaf alone', async () => {
        const checked: string[][] = [];
        const { container } = render(
            <Files checkbox bDisabled root={{ defaultCheckedValues: [], onCheckedValuesChange: (v: string[]) => checked.push(v) }} />,
        );
        const box = (value: string) => partsOf(row(container, value), 'node-checkbox')[0]!;
        // lib's only enabled leaf is a.ts.
        await act(() => fire(box('src'), 'catchtap'));
        expect(checked.at(-1)?.slice().sort()).toEqual(['a.ts', 'src/index.ts']);
        expect(box('src').props['data-state']).toBe('checked');
        expect(box('b.ts').props['data-state']).toBe('unchecked');
        expect(box('b.ts').props['data-disabled']).toBe('');
        // Unchecking one leaf makes its ancestors indeterminate.
        await act(() => fire(box('a.ts'), 'catchtap'));
        expect(box('lib').props['data-state']).toBe('unchecked');
        expect(box('src').props['data-state']).toBe('indeterminate');
        const mark = partsOf(row(container, 'src'), 'node-checkbox')[0]!.children.find((c) => c.type === 'text');
        expect(mark).toBeDefined();
        conforms(container);
        // The box tap neither selected nor expanded.
        expect(row(container, 'src').props['data-state']).toBe('closed');
        expect(classOf(row(container, 'src'))).not.toContain('zx-f-selected');
        // The row announces the mixed state.
        expect(row(container, 'src').props['accessibility-status']).toBe('mixed, collapsed');
    });

    it('with no selection in use a leaf tap toggles its check and nothing reads selected', async () => {
        const checked: string[][] = [];
        const { container } = render(
            <Files checkbox root={{ checkable: true, onCheckedValuesChange: (v: string[]) => checked.push(v) }} />,
        );
        await tap(row(container, 'README.md'));
        expect(checked.at(-1)).toEqual(['README.md']);
        expect(classOf(row(container, 'README.md'))).not.toContain('zx-f-selected');
        expect(row(container, 'README.md').props['accessibility-status']).toBe('checked');
        // A branch row still folds.
        await tap(row(container, 'src'));
        expect(row(container, 'src').props['data-state']).toBe('open');
    });

    it('binds model:checkedValues and model:expandedValues', async () => {
        const state = signal({ checked: ['a'] as string[], open: [] as string[] });
        const { container } = render(
            <TreeView.Root model:checkedValues={() => state.checked} model:expandedValues={() => state.open}>
                <TreeView.Tree>
                    <TreeView.Branch value="x">
                        <TreeView.BranchTrigger><TreeView.NodeCheckbox /><text>x</text></TreeView.BranchTrigger>
                        <TreeView.BranchContent>
                            <TreeView.Item value="a"><TreeView.NodeCheckbox /><text>a</text></TreeView.Item>
                            <TreeView.Item value="b"><TreeView.NodeCheckbox /><text>b</text></TreeView.Item>
                        </TreeView.BranchContent>
                    </TreeView.Branch>
                </TreeView.Tree>
            </TreeView.Root>,
        );
        const box = (label: string) => partsOf(row(container, label), 'node-checkbox')[0]!;
        expect(box('x').props['data-state']).toBe('indeterminate');
        await act(() => fire(box('b'), 'catchtap'));
        expect([...state.checked].sort()).toEqual(['a', 'b']);
        expect(box('x').props['data-state']).toBe('checked');
        await tap(row(container, 'x'));
        expect([...state.open]).toEqual(['x']);
        await act(() => { state.open = []; });
        expect(row(container, 'x').props['data-state']).toBe('closed');
    });

    it('a branch whose every leaf is disabled has a disabled box', () => {
        const { container } = render(
            <TreeView.Root checkable>
                <TreeView.Tree>
                    <TreeView.Branch value="x">
                        <TreeView.BranchTrigger><TreeView.NodeCheckbox /><text>x</text></TreeView.BranchTrigger>
                        <TreeView.BranchContent>
                            <TreeView.Item value="y" disabled><TreeView.NodeCheckbox /><text>y</text></TreeView.Item>
                        </TreeView.BranchContent>
                    </TreeView.Branch>
                </TreeView.Tree>
            </TreeView.Root>,
        );
        conforms(container);
        const box = partsOf(container as never, 'node-checkbox')[0]!;
        expect(box.props['data-disabled']).toBe('');
    });
});
