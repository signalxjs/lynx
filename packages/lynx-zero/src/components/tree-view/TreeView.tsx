/**
 * TreeView — zero's `tree-view` scope (the APG tree pattern) on lynx:
 * nested branches that expand and collapse, single or multiple selection,
 * and an optional tri-state check model.
 *
 * ```tsx
 * <TreeView.Root model={() => state.selected} defaultExpandedValues={['src']}>
 *     <TreeView.Label>Files</TreeView.Label>
 *     <TreeView.Tree>
 *         <TreeView.Branch value="src">
 *             <TreeView.BranchTrigger>
 *                 <TreeView.BranchIndicator /><text>src</text>
 *             </TreeView.BranchTrigger>
 *             <TreeView.BranchContent>
 *                 <TreeView.Item value="src/index.ts"><text>index.ts</text></TreeView.Item>
 *             </TreeView.BranchContent>
 *         </TreeView.Branch>
 *         <TreeView.Item value="README.md"><text>README.md</text></TreeView.Item>
 *     </TreeView.Tree>
 * </TreeView.Root>
 * ```
 *
 * The models are zero's: the unnamed `model` is the selection — a `string`
 * (`''` when none) in single mode, a `string[]` under `multiple`;
 * `model:expandedValues` is the set of open branches; `model:checkedValues`
 * (or `checkable`) makes the tree checkable, holding the checked LEAF values.
 * A branch's check state is derived, never stored: `checked` when every
 * enabled descendant leaf is, `indeterminate` when some are, and toggling it
 * checks or unchecks all of them (a disabled leaf keeps its value).
 *
 * What the platform changes:
 * - **Touch, not keyboard.** zero's roving focus, typeahead and arrow-key
 *   expansion are keyboard semantics this platform has no surface for, so
 *   they are not wired. `focus-visible` stays in the anatomy (a skin draws
 *   it; `ForceStates` shows it) but nothing stamps it live.
 * - **A tap is the gesture.** A tap on a leaf selects it; on a branch row it
 *   selects the branch and — while `expandOnClick` is on (the default) —
 *   toggles it too. With `expandOnClick={false}` the row only selects and the
 *   BranchIndicator is the toggle's hit area (it catches its tap). Under
 *   `multiple` a tap TOGGLES the node in or out of the selection — the touch
 *   spelling of the web's Ctrl/Cmd+click; there are no modifier keys to
 *   extend a range with.
 * - **Checkable, no selection in use** (checkable with no `multiple`,
 *   `model` or `defaultValue`): a tap on a leaf row toggles its check, as on
 *   the web, and no node announces `selected`. `NodeCheckbox` catches its own
 *   tap, so it toggles the check without selecting or folding the row.
 * - **Collapsed content stays mounted.** The web keeps a closed subtree in
 *   the DOM (`hidden`) so its nodes stay registered; here the content keeps
 *   the same `hidden` attribute and collapses to a clipped, transparent 0×0
 *   box out of flow (not `display: none`, whose text still paints on lynx,
 *   #1271), so a collapsed branch's derived check state still sees every
 *   leaf below it. The closed box is hidden from accessibility too.
 * - **Glyphs are text.** The default BranchIndicator is a `<text>` part
 *   holding `›` (the anatomy's glyph) and a checked NodeCheckbox holds `✓`
 *   (`−` when indeterminate): lynx has no pseudo-elements for a skin to draw
 *   them with. They inherit the box's ink by CSS inheritance.
 * - **The row inks its label.** The row's text is the author's `<text>`,
 *   inked by inheritance from the row. A skin must not transition the
 *   row's `color` on lynx: the new animator ticks a transitioned colour into
 *   the row's own paint only, so the label kept the old ink after a live
 *   selection (#1292; the daisy skin's lynx target transitions background
 *   only, zero#522).
 * - **Rows tint, they do not scale.** The rows' press feedback is tier 1 (the
 *   `pressed` flag, no main-thread scale): daisy's rows sink by tint. Pass
 *   `pressFeel` on the Root for the main-thread feel.
 * - **Indentation** is the skin's: branch-content carries a physical left
 *   padding and nesting does the rest — no per-depth rules.
 *
 * Nodes (Item, Branch) take a `value` prop and emit nothing — runtime-core
 * resolves a component's event handlers through `props.value` when one
 * exists. The ROOT emits and deliberately has no `value` prop.
 */
import type { Define, JSXElement } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide, onUnmounted, signal } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import type { TriState } from '@sigx/zero/behaviors/core';
import { createControllableState, namedModel, toggleTriState, triState } from '@sigx/zero/behaviors/core';
import type { FactoryBrands, JsxProps } from '@sigx/zero/contract/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';

const anatomy = anatomies['tree-view'];

/** One registered node: enough to walk the tree without an element. */
export interface TreeNodeEntry {
    value: string;
    /** The enclosing branch's value; `null` at the top level. */
    parentValue: string | null;
    isBranch: boolean;
    disabled(): boolean;
}

/**
 * The tree's node registry — the structure-only half of zero's tree
 * controller (no elements, no visible-order walk: nothing here navigates).
 * `version` is the reactive seam: every register/unregister bumps it, so a
 * derived branch check state re-reads the leaves below it.
 */
export interface TreeRegistry {
    register(entry: TreeNodeEntry): () => void;
    find(value: string): TreeNodeEntry | undefined;
    /** Every leaf below `value`, at any depth. */
    leavesOf(value: string): TreeNodeEntry[];
}

export function createTreeRegistry(): TreeRegistry {
    const nodes = new Map<string, TreeNodeEntry>();
    const version = signal({ n: 0 });
    // Derived per registry version, not per read: every row's check state
    // asks for leaves on each render, so the parent → children index is
    // built once after a change and each branch's leaf list is memoized
    // until the next one. `stamp` mirrors `version.n` outside the signal.
    let stamp = 0;
    let children: Map<string | null, TreeNodeEntry[]> | null = null;
    const leaves = new Map<string, TreeNodeEntry[]>();
    const changed = (): void => {
        stamp++;
        children = null;
        leaves.clear();
        version.n = stamp;
    };
    const childIndex = (): Map<string | null, TreeNodeEntry[]> => {
        if (children) return children;
        const index = new Map<string | null, TreeNodeEntry[]>();
        for (const entry of nodes.values()) {
            const siblings = index.get(entry.parentValue);
            if (siblings) siblings.push(entry);
            else index.set(entry.parentValue, [entry]);
        }
        children = index;
        return index;
    };
    const collect = (value: string): TreeNodeEntry[] => {
        const index = childIndex();
        const out: TreeNodeEntry[] = [];
        const seen = new Set<string>([value]);
        const stack = [...(index.get(value) ?? [])];
        while (stack.length > 0) {
            const entry = stack.pop()!;
            if (seen.has(entry.value)) continue;
            seen.add(entry.value);
            if (entry.isBranch) stack.push(...(index.get(entry.value) ?? []));
            else out.push(entry);
        }
        return out;
    };
    return {
        register(entry) {
            nodes.set(entry.value, entry);
            changed();
            return () => {
                if (nodes.get(entry.value) === entry) nodes.delete(entry.value);
                changed();
            };
        },
        find(value) {
            void version.n;
            return nodes.get(value);
        },
        leavesOf(value) {
            void version.n;
            let list = leaves.get(value);
            if (!list) {
                list = collect(value);
                leaves.set(value, list);
            }
            return list;
        },
    };
}

/**
 * The selection under either model shape — a string reads as a one-element
 * list (empty when `''`), an array is de-duplicated.
 */
export function treeSelection(value: string | string[] | null | undefined): string[] {
    if (Array.isArray(value)) return [...new Set(value)];
    return value ? [value] : [];
}

/**
 * The next selection after a tap on `value`: single mode selects it alone;
 * under `multiple` the tap toggles it in or out (touch has no modifier keys).
 */
export function treeSelectNext(current: readonly string[], value: string, multiple: boolean): string | string[] {
    if (!multiple) return value;
    return current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
}

interface TreeViewContext {
    registry: TreeRegistry;
    multiple(): boolean;
    /** Is the selection in use? See the module doc (checkable, no selection model). */
    selecting(): boolean;
    checkable(): boolean;
    isSelected(value: string): boolean;
    /** A tap selected `value` (single: alone; multiple: toggled). */
    select(value: string): void;
    isExpanded(value: string): boolean;
    toggleBranch(value: string): void;
    expandOnClick(): boolean;
    checkState(value: string, isBranch: boolean): TriState;
    toggleCheck(value: string): void;
    checkDisabled(value: string, isBranch: boolean): boolean;
    disabled(): boolean;
    pressFeel(): boolean;
}

const makeInert = (): TreeViewContext => ({
    registry: createTreeRegistry(),
    multiple: () => false,
    selecting: () => true,
    checkable: () => false,
    isSelected: () => false,
    select: () => {},
    isExpanded: () => false,
    toggleBranch: () => {},
    expandOnClick: () => true,
    checkState: () => 'unchecked',
    toggleCheck: () => {},
    checkDisabled: () => false,
    disabled: () => false,
    pressFeel: () => false,
});

const useTreeViewContext = defineInjectable<TreeViewContext>(makeInert);

/** The enclosing branch — `null` value at the top level. */
interface TreeBranchContext {
    value: string | null;
    disabled(): boolean;
    loading(): boolean;
}

const useTreeBranchContext = defineInjectable<TreeBranchContext>(() => ({
    value: null,
    disabled: () => false,
    loading: () => false,
}));

/** The node a row belongs to (an Item's shadows its Branch's), for NodeCheckbox. */
interface TreeNodeContext {
    value: string | null;
    isBranch: boolean;
}

const useTreeNodeContext = defineInjectable<TreeNodeContext>(() => ({ value: null, isBranch: false }));

/** `''` is single mode's "nothing selected": a node carrying it could never read as selected. */
function refuseEmptySentinel(ctx: TreeViewContext, value: string, part: string): void {
    if (value === '' && !ctx.multiple()) {
        throw new Error(`[@sigx/lynx-zero] TreeView: a ${part} valued "" is reserved for "nothing selected" in single mode — give it a non-empty value`);
    }
}

// ── Root ──

/**
 * The props, generic over the selection model `M`: `string` in single mode,
 * `string[]` under `multiple` — the exported `TreeView.Root` narrows it from
 * `multiple`.
 */
export type TreeViewRootProps<M = string | string[]> =
    & Define.Model<M>
    & Define.Prop<'defaultValue', M, false>
    & Define.Event<'valueChange', M>
    /** More than one selected node; a tap toggles a node in or out (default false). */
    & Define.Prop<'multiple', boolean, false>
    /** The open branches' values. */
    & Define.Model<'expandedValues', string[]>
    & Define.Prop<'defaultExpandedValues', string[], false>
    & Define.Event<'expandedValuesChange', string[]>
    /**
     * A tap on a branch row toggles it as well as selecting it (default
     * `true`). `false`: the row only selects; the BranchIndicator toggles.
     */
    & Define.Prop<'expandOnClick', boolean, false>
    /** The checked LEAF values; binding it (or seeding the default) makes the tree checkable. */
    & Define.Model<'checkedValues', string[]>
    & Define.Prop<'defaultCheckedValues', string[], false>
    & Define.Event<'checkedValuesChange', string[]>
    /** Checkable without binding `checkedValues` (default false). */
    & Define.Prop<'checkable', boolean, false>
    /** Disable every node. */
    & Define.Prop<'disabled', boolean, false>
    /** The rows' main-thread press feel (default false — rows tint only). */
    & Define.Prop<'pressFeel', boolean, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const TreeViewRootImpl = component<TreeViewRootProps>(({ props, slots, emit }) => {
    const selected = createControllableState<string | string[]>(
        () => props.model,
        props.defaultValue !== undefined ? props.defaultValue : props.multiple ? [] : '',
        (value) => emit('valueChange', value),
    );
    const expanded = createControllableState<string[]>(
        () => namedModel<string[]>(props.expandedValues),
        props.defaultExpandedValues ?? [],
        (value) => emit('expandedValuesChange', value),
    );
    const checked = createControllableState<string[]>(
        () => namedModel<string[]>(props.checkedValues),
        props.defaultCheckedValues ?? [],
        (value) => emit('checkedValuesChange', value),
    );
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, { color: props.color, size: props.size }));
    const registry = createTreeRegistry();
    const disabled = (): boolean => !!props.disabled;
    const checkable = (): boolean =>
        !!props.checkable || props.checkedValues !== undefined || props.defaultCheckedValues !== undefined;
    const selecting = (): boolean =>
        !checkable() || !!props.multiple || props.model !== undefined || props.defaultValue !== undefined;
    const isExpanded = (value: string): boolean => expanded.value.includes(value);
    /** A branch's check members: its enabled leaves — or all, when every one is disabled. */
    const checkMembers = (value: string): { all: string[]; enabled: string[] } => {
        const leaves = registry.leavesOf(value);
        return {
            all: leaves.map((n) => n.value),
            enabled: leaves.filter((n) => !n.disabled()).map((n) => n.value),
        };
    };

    const ctx: TreeViewContext = {
        registry,
        multiple: () => !!props.multiple,
        selecting,
        checkable,
        isSelected: (value) => selecting() && treeSelection(selected.value).includes(value),
        select: (value) => {
            if (disabled() || !selecting()) return;
            selected.value = treeSelectNext(treeSelection(selected.value), value, !!props.multiple);
        },
        isExpanded,
        toggleBranch: (value) => {
            if (disabled()) return;
            expanded.value = isExpanded(value)
                ? expanded.value.filter((v) => v !== value)
                : [...expanded.value, value];
        },
        expandOnClick: () => props.expandOnClick ?? true,
        checkState: (value, isBranch) => {
            const current = checked.value;
            if (!isBranch) return current.includes(value) ? 'checked' : 'unchecked';
            const { all, enabled } = checkMembers(value);
            return triState(enabled.length > 0 ? enabled : all, current);
        },
        toggleCheck: (value) => {
            if (disabled() || !checkable()) return;
            const node = registry.find(value);
            if (!node || node.disabled()) return;
            const current = checked.value;
            if (!node.isBranch) {
                checked.value = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
                return;
            }
            const { enabled } = checkMembers(value);
            if (enabled.length > 0) checked.value = toggleTriState(enabled, current);
        },
        checkDisabled: (value, isBranch) => {
            if (disabled() || registry.find(value)?.disabled()) return true;
            if (!isBranch) return false;
            // A branch whose leaves have not registered yet has nothing, not
            // nothing enabled.
            const { all, enabled } = checkMembers(value);
            return all.length > 0 && enabled.length === 0;
        },
        disabled,
        pressFeel: () => !!props.pressFeel,
    };
    defineProvide(useTreeViewContext, () => ctx);

    return () => (
        <view
            {...partBag(anatomy, 'root', {
                flags: { disabled: disabled() },
                ...partAxes(axes()),
                class: props.class,
            })}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'TreeView.Root' });

/** The exported root: the selection model's shape follows `multiple`. */
export type TreeViewRoot = {
    (props: JsxProps<TreeViewRootProps<string>> & { multiple?: false }): JSXElement;
    (props: JsxProps<TreeViewRootProps<string[]>> & { multiple: true }): JSXElement;
} & FactoryBrands;

const TreeViewRoot = TreeViewRootImpl as unknown as TreeViewRoot;

// ── Label / Tree ──

export type TreeViewPartProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

/** The tree's visible name (a `<text>`: pass the words as children). */
const TreeViewLabel = component<TreeViewPartProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <text {...partBag(anatomy, 'label', { ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </text>
    );
}, { name: 'TreeView.Label' });

/**
 * The node container. Not an accessibility element: on lynx that would fold
 * every row into one node, so each row announces itself.
 */
const TreeViewTree = component<TreeViewPartProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <view {...partBag(anatomy, 'tree', { ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </view>
    );
}, { name: 'TreeView.Tree' });

// ── Item (leaf) ──

export type TreeViewItemProps =
    & Define.Prop<'value', string, true>
    & Define.Prop<'disabled', boolean, false>
    /** Accessible name — defaults to the row's text as the reader finds it. */
    & Define.Prop<'label', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

/** The reader's status for a row: checked/mixed, selected, expanded, disabled. */
function rowA11y(ctx: TreeViewContext, value: string, isBranch: boolean, disabled: boolean, label: string | undefined, expanded?: boolean): Record<string, unknown> {
    const check = ctx.checkable() ? ctx.checkState(value, isBranch) : undefined;
    return partA11y({
        trait: 'button',
        label,
        checked: check === undefined ? undefined : check === 'checked',
        mixed: check === 'indeterminate',
        selected: ctx.isSelected(value),
        expanded,
        disabled,
    });
}

const TreeViewItem = component<TreeViewItemProps>(({ props, slots }) => {
    const ctx = useTreeViewContext();
    refuseEmptySentinel(ctx, props.value, 'item');
    const branch = useTreeBranchContext();
    const axes = useVariantAxes();
    const disabled = (): boolean => !!props.disabled || ctx.disabled();
    const press = createPressFeedback({ isDisabled: disabled, feel: ctx.pressFeel() });
    // Registered under the value it had at setup — a node's identity.
    const value = props.value;
    onUnmounted(ctx.registry.register({ value, parentValue: branch.value, isBranch: false, disabled }));
    defineProvide(useTreeNodeContext, () => ({ value, isBranch: false }));

    return () => (
        <view
            {...partBag(anatomy, 'item', {
                flags: { selected: ctx.isSelected(props.value), disabled: disabled(), pressed: press.pressed() },
                ...partAxes(axes()),
                class: props.class,
            })}
            {...rowA11y(ctx, props.value, false, disabled(), props.label)}
            bindtap={() => {
                if (disabled()) return;
                // No selection in use: the row is the box's label.
                if (!ctx.selecting()) ctx.toggleCheck(props.value);
                else ctx.select(props.value);
            }}
            {...press.handlers}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'TreeView.Item' });

// ── Branch ──

export type TreeViewBranchProps =
    & Define.Prop<'value', string, true>
    /** The children are being fetched: the indicator (and open content) read `loading`. */
    & Define.Prop<'loading', boolean, false>
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

/**
 * The treeitem wrapper: trigger row over content. Structure only — the row
 * look lives on BranchTrigger, and the wrapper is no accessibility element
 * (the row announces the branch).
 */
const TreeViewBranch = component<TreeViewBranchProps>(({ props, slots }) => {
    const ctx = useTreeViewContext();
    refuseEmptySentinel(ctx, props.value, 'branch');
    const parent = useTreeBranchContext();
    const axes = useVariantAxes();
    const disabled = (): boolean => !!props.disabled || ctx.disabled();
    const value = props.value;
    onUnmounted(ctx.registry.register({ value, parentValue: parent.value, isBranch: true, disabled }));
    defineProvide(useTreeBranchContext, () => ({ value, disabled, loading: () => !!props.loading }));
    defineProvide(useTreeNodeContext, () => ({ value, isBranch: true }));

    return () => (
        <view
            {...partBag(anatomy, 'branch', {
                state: ctx.isExpanded(props.value) ? 'open' : 'closed',
                flags: { selected: ctx.isSelected(props.value), disabled: disabled() },
                ...partAxes(axes()),
                class: props.class,
            })}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'TreeView.Branch' });

export type TreeViewBranchTriggerProps =
    /** Accessible name — defaults to the row's text as the reader finds it. */
    & Define.Prop<'label', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

/** The branch's visible, tappable row. */
const TreeViewBranchTrigger = component<TreeViewBranchTriggerProps>(({ props, slots }) => {
    const ctx = useTreeViewContext();
    const branch = useTreeBranchContext();
    const axes = useVariantAxes();
    const value = (): string => branch.value ?? '';
    const disabled = (): boolean => branch.disabled() || ctx.disabled();
    const press = createPressFeedback({ isDisabled: disabled, feel: ctx.pressFeel() });

    return () => {
        const open = ctx.isExpanded(value());
        return (
            <view
                {...partBag(anatomy, 'branch-trigger', {
                    state: open ? 'open' : 'closed',
                    flags: { selected: ctx.isSelected(value()), disabled: disabled(), pressed: press.pressed() },
                    ...partAxes(axes()),
                    class: props.class,
                })}
                {...rowA11y(ctx, value(), true, disabled(), props.label, open)}
                bindtap={() => {
                    if (disabled() || branch.value === null) return;
                    ctx.select(value());
                    if (ctx.expandOnClick()) ctx.toggleBranch(value());
                }}
                {...press.handlers}
            >
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'TreeView.BranchTrigger' });

export type TreeViewBranchIndicatorProps =
    & Define.Prop<'class', string, false>
    /** Replaces the default `›` glyph (render a `<text>` or an icon). */
    & Define.Slot<'default'>;

/**
 * The branch's disclosure mark — a `<text>` holding `›` by default, which
 * the skin turns to point down while open. With `expandOnClick={false}` on
 * the Root it is the toggle's hit area and catches its own tap.
 */
const TreeViewBranchIndicator = component<TreeViewBranchIndicatorProps>(({ props, slots }) => {
    const ctx = useTreeViewContext();
    const branch = useTreeBranchContext();
    const axes = useVariantAxes();
    return () => {
        const value = branch.value;
        const state = branch.loading() ? 'loading' : value !== null && ctx.isExpanded(value) ? 'open' : 'closed';
        const bag = {
            ...partBag(anatomy, 'branch-indicator', { state, ...partAxes(axes()), class: props.class }),
            // Decoration: the row announces expanded/collapsed.
            'accessibility-element': false,
            ...(ctx.expandOnClick() || value === null
                ? {}
                : {
                    catchtap: () => {
                        if (!branch.disabled() && !ctx.disabled()) ctx.toggleBranch(value);
                    },
                }),
        };
        return slots.default
            ? <view {...bag}>{slots.default()}</view>
            : <text {...bag}>›</text>;
    };
}, { name: 'TreeView.BranchIndicator' });

export type TreeViewBranchContentProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

/** An open branch's content: in flow, a column like any tree level. */
export const OPEN_CONTENT_STYLE = { display: 'flex' } as const;

/**
 * A closed branch's content (#1271): taken out of flow and collapsed to a
 * clipped, transparent, invisible 0×0 box at the branch's origin — NOT
 * `display: none`. On lynx a `display: none` view stops laying out but its
 * `<text>` descendants keep painting (iOS from mount; Android once a branch
 * folds live), so a closed branch drew its leaves' text over its own row.
 * Each property here hides the subtree by a different route (the clip, the
 * layer alpha, the visibility flag), so no one engine gap can leak it; the
 * content view is kept unflattened (`flatten={false}`) so it owns the
 * native view the clip and the alpha act on.
 */
export const CLOSED_CONTENT_STYLE = {
    display: 'flex',
    position: 'absolute',
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    overflow: 'hidden',
    opacity: 0,
    visibility: 'hidden',
} as const;

/**
 * The subtree. Always rendered — collapsed to a hidden 0×0 box (see
 * `CLOSED_CONTENT_STYLE`) plus the anatomy's `hidden` while closed — so a
 * collapsed branch's nodes stay registered (see the module doc).
 */
const TreeViewBranchContent = component<TreeViewBranchContentProps>(({ props, slots }) => {
    const ctx = useTreeViewContext();
    const branch = useTreeBranchContext();
    const axes = useVariantAxes();
    return () => {
        const open = branch.value !== null && ctx.isExpanded(branch.value);
        const state = !open ? 'closed' : branch.loading() ? 'loading' : 'open';
        return (
            <view
                {...partBag(anatomy, 'branch-content', { state, ...partAxes(axes()), class: props.class })}
                {...(open ? {} : { hidden: true, 'accessibility-elements-hidden': true })}
                flatten={false}
                style={open ? OPEN_CONTENT_STYLE : CLOSED_CONTENT_STYLE}
            >
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'TreeView.BranchContent' });

// ── NodeCheckbox ──

export type TreeViewNodeCheckboxProps =
    & Define.Prop<'class', string, false>
    /** Replaces the default `✓` / `−` mark. */
    & Define.Slot<'default'>;

/** The mark a node's check state draws — `null` while unchecked. */
export function nodeCheckMark(state: TriState): string | null {
    return state === 'checked' ? '✓' : state === 'indeterminate' ? '−' : null;
}

/**
 * A checkable node's box, inside an Item or a BranchTrigger. Paint only for
 * the reader (the row announces checked/mixed); its tap toggles the node's
 * check and nothing else — no selection, no expansion.
 */
const TreeViewNodeCheckbox = component<TreeViewNodeCheckboxProps>(({ props, slots }) => {
    const ctx = useTreeViewContext();
    const node = useTreeNodeContext();
    const axes = useVariantAxes();
    const disabled = (): boolean => ctx.disabled() || (node.value !== null && ctx.checkDisabled(node.value, node.isBranch));
    return () => {
        const value = node.value;
        const state: TriState = value === null ? 'unchecked' : ctx.checkState(value, node.isBranch);
        const mark = nodeCheckMark(state);
        return (
            <view
                {...partBag(anatomy, 'node-checkbox', { state, flags: { disabled: disabled() }, ...partAxes(axes()), class: props.class })}
                accessibility-element={false}
                {...(value === null
                    ? {}
                    : {
                        catchtap: () => {
                            if (!disabled()) ctx.toggleCheck(value);
                        },
                    })}
            >
                {slots.default ? slots.default() : mark !== null ? <text>{mark}</text> : null}
            </view>
        );
    };
}, { name: 'TreeView.NodeCheckbox' });

export const TreeView = compound(TreeViewRoot, {
    Root: TreeViewRoot,
    Label: TreeViewLabel,
    Tree: TreeViewTree,
    Item: TreeViewItem,
    Branch: TreeViewBranch,
    BranchTrigger: TreeViewBranchTrigger,
    BranchIndicator: TreeViewBranchIndicator,
    BranchContent: TreeViewBranchContent,
    NodeCheckbox: TreeViewNodeCheckbox,
});
