/**
 * Table — rows of cells under a header row, zero's `table` anatomy on lynx.
 *
 * ```tsx
 * <Table.Root mods={{ zebra: true }} model:sort={() => state.sort}>
 *     <Table.Caption>Quarterly revenue</Table.Caption>
 *     <Table.Head>
 *         <Table.Row>
 *             <Table.HeaderCell sortable column="quarter">Quarter</Table.HeaderCell>
 *             <Table.HeaderCell>Revenue</Table.HeaderCell>
 *         </Table.Row>
 *     </Table.Head>
 *     <Table.Body>
 *         <Table.Row>
 *             <Table.Cell>Q1</Table.Cell>
 *             <Table.Cell>$12,930</Table.Cell>
 *         </Table.Row>
 *     </Table.Body>
 * </Table.Root>
 * ```
 *
 * Lynx has no `<table>` and no grid, so every part is a `view` and the
 * table's layout is spelled out by the runtime:
 *
 * - **Rows are flex rows; cells share them.** A cell takes its column's
 *   width from `Table.Root columns` by its PLACE in the row (the way a
 *   `<colgroup>` sizes the web's columns) — `number` or `'Npx'` fixes it,
 *   `'N%'` takes that share of the row, and a column with no width shares
 *   the slack (`flex: 1`). `colSpan` covers that many columns; `rowSpan` is
 *   not carried. The `colgroup` / `column` parts are not rendered (they have
 *   nothing to lay out here).
 * - **A table of fixed columns scrolls.** When every column in the spec has
 *   a pixel width, the table is as wide as their sum and the root is a
 *   horizontal `<scroll-view>` — the web root's `overflow-x: auto`. Any
 *   other table fits its container.
 * - **String content is wrapped in `<text>`** (lynx renders text only
 *   there), so a cell takes a plain string; any other content renders as
 *   given. A column's `align` aligns both.
 * - **Sorting** is zero's: a `sortable` header cell renders its content in
 *   the pressable `sort-trigger` (the `button` trait, its own press
 *   feedback) with the `sort-indicator` ▲ after it, carries the sort state,
 *   and cycles `model:sort` (`nextTableSort`). The runtime never sorts rows.
 *   The unsorted mark, which the web reveals on hover and keyboard focus,
 *   is revealed while the trigger is held (`zx-m-held` on the indicator).
 * - **Zebra** (`mods={{ zebra: true }}`): lynx has no `:nth-child`, so the
 *   body tracks its rows in mount order and stamps every even, unselected
 *   row `stripe` (`zx-m-stripe`). The `hover` mod is accepted but has
 *   nothing to answer on a touch screen.
 * - **`stack`** is resolved in JS against the screen width — lynx has no
 *   `@media`. `true` always stacks; a breakpoint name (`sm` 640, `md` 768,
 *   `lg` 1024, `xl` 1280, `2xl` 1536 — the daisy scale) stacks below it.
 *   A stacked table stamps `stacked` (`zx-m-stacked`) on its parts: each
 *   row becomes a block, each cell a line opening with its column's label
 *   (the `cell-label` part), and the head row is visually hidden rather than
 *   removed.
 * - **Accessibility** is the five-prop native surface: lynx has no table
 *   semantics to map to, so the containers carry none (an accessible
 *   container hides its content on iOS) and each cell is read as its text.
 *   The sort trigger is a `button` named by its content (or `label`), with
 *   the sort direction appended ("Name, sorted ascending").
 * - **Web-only:** the root's keyboard stop and `focus-visible` ring (never
 *   set live — the gallery forces it), the caption-named region, hover.
 */
import type { Define, JSXElement } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide, signal, useScreen } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { createControllableState, namedModel } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';
import { VISUALLY_HIDDEN } from '../../shared/native-text.js';

const anatomy = anatomies.table;

/**
 * One column of the table's column spec. Every field is optional: a column
 * with nothing to say still holds its place, so indexes line up.
 */
export interface TableColumn {
    /** A stable name a cell can use in `column` instead of an index. */
    key?: string;
    /** The header text `<Table.Head />` renders for this column (and a stacked cell's label). */
    label?: string;
    /** `number` / `'Npx'` (fixed) or `'N%'` (a share of the row). Omitted → shares the slack. */
    width?: number | string;
    /** Text alignment for the column's cells. */
    align?: 'start' | 'center' | 'end';
    /** `<Table.Head />` renders this column's header cell `sortable`, sorting under its `key`. */
    sortable?: boolean;
}

/** Which way a sorted column runs — `aria-sort`'s own spellings. */
export type TableSortDirection = 'ascending' | 'descending';

/** The table's sort: the column it is sorted by and the direction. `null` is unsorted. */
export interface TableSort {
    column: string;
    direction: TableSortDirection;
}

/**
 * What one activation of a sort trigger does — zero's rule, verbatim (the
 * web module that exports it is DOM-bound): an unsorted column starts
 * `ascending`, a sorted one flips — or, on the `three` cycle, goes
 * `descending` → unsorted (`null`).
 */
export function nextTableSort(current: TableSort | null, column: string, cycle: 'two' | 'three' = 'two'): TableSort | null {
    if (current?.column !== column) return { column, direction: 'ascending' };
    if (current.direction === 'ascending') return { column, direction: 'descending' };
    return cycle === 'three' ? null : { column, direction: 'ascending' };
}

/** The daisy breakpoint scale `stack` resolves against, in logical px. */
export const TABLE_STACK_BREAKPOINTS: Readonly<Record<string, number>> = {
    sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536,
};

/** Whether a table with `stack` stacks at `screenWidth` — `true` always does. */
export function tableStacks(stack: string | boolean | undefined, screenWidth: number): boolean {
    if (stack === true) return true;
    if (!stack) return false;
    const below = TABLE_STACK_BREAKPOINTS[stack];
    if (below === undefined) {
        throw new Error(`[@sigx/lynx-zero] Table: stack "${stack}" is not a breakpoint (expected one of ${Object.keys(TABLE_STACK_BREAKPOINTS).join(', ')}, or true)`);
    }
    return screenWidth < below;
}

/** A column width as lynx lays it out: fixed px, a % share, or none (shares the slack). */
type ParsedWidth = { px: number } | { pct: number } | null;

function parseWidth(width: number | string | undefined): ParsedWidth {
    if (typeof width === 'number') return Number.isFinite(width) && width >= 0 ? { px: width } : null;
    if (typeof width !== 'string') return null;
    const m = /^\s*(\d+(?:\.\d+)?)\s*(px|%)?\s*$/.exec(width);
    if (!m) {
        throw new Error(`[@sigx/lynx-zero] Table: column width "${width}" is not a lynx width (use a number, "Npx" or "N%")`);
    }
    const n = Number(m[1]);
    return m[2] === '%' ? { pct: n } : { px: n };
}

/**
 * The layout style of a cell covering columns `[place, place + span)`:
 * all fixed → their px sum; a single % column → that share; otherwise it
 * grows by the number of columns with no fixed width. Pure — the unit
 * tests read it.
 */
export function tableCellBox(columns: readonly TableColumn[], place: number, span = 1): Record<string, string | number> {
    const widths = Array.from({ length: Math.max(1, span) }, (_, i) => parseWidth(columns[place + i]?.width));
    if (widths.every((w) => w !== null && 'px' in w)) {
        const px = widths.reduce((sum, w) => sum + (w as { px: number }).px, 0);
        return { width: `${px}px`, flexGrow: 0, flexShrink: 0 };
    }
    if (widths.length === 1 && widths[0] && 'pct' in widths[0]) {
        return { width: `${widths[0].pct}%`, flexGrow: 0, flexShrink: 0 };
    }
    const grow = widths.filter((w) => w === null).length || widths.length;
    return { flexGrow: grow, flexShrink: 1, flexBasis: 0 };
}

/** The spec's total width when every column is fixed in px — the scroll box's content width. */
export function tableFixedWidth(columns: readonly TableColumn[]): number | null {
    if (columns.length === 0) return null;
    let sum = 0;
    for (const column of columns) {
        const w = parseWidth(column.width);
        if (!w || !('px' in w)) return null;
        sum += w.px;
    }
    return sum;
}

const ALIGN_ITEMS = { start: 'flex-start', center: 'center', end: 'flex-end' } as const;
const TEXT_ALIGN = { start: 'left', center: 'center', end: 'right' } as const;

/** Content that is only strings and numbers, as one string — `undefined` for anything else. */
function plainText(content: unknown): string | undefined {
    const list = Array.isArray(content) ? content : [content];
    if (list.length === 0 || !list.every((c) => typeof c === 'string' || typeof c === 'number')) return undefined;
    return list.join('');
}

/** Plain string content in a `<text>` (lynx renders text nowhere else); anything else as given. */
function asText(content: unknown, align: TableColumn['align'] | undefined): unknown {
    const text = plainText(content);
    if (text === undefined) return content;
    return <text style={align ? { textAlign: TEXT_ALIGN[align] } : undefined}>{text}</text>;
}

interface TableContext {
    columns(): readonly TableColumn[];
    stacked(): boolean;
    sort(): TableSort | null;
    toggleSort(column: string): void;
}

const useTableContext = defineInjectable<TableContext>(() => ({
    columns: () => [],
    stacked: () => false,
    sort: () => null,
    toggleSort: () => {},
}));

/** The body's row order (mount order) — the zebra stripe's parity. */
interface SectionContext {
    register(id: number): () => void;
    /** 0-based place of row `id` in the body, or -1 outside a body. */
    place(id: number): number;
}

const useSectionContext = defineInjectable<SectionContext>(() => ({
    register: () => () => {},
    place: () => -1,
}));

/** A row's cells in mount order, with their spans — each cell's column place. */
interface RowContext {
    register(id: number, span: () => number): () => void;
    /** The first column cell `id` covers. */
    place(id: number): number;
}

const useRowContext = defineInjectable<RowContext>(() => ({
    register: () => () => {},
    place: () => 0,
}));

let nextId = 0;

/** The column spec entry a cell names by `column` (index or key), else the one at its place. */
function columnOf(ctx: TableContext, ref: number | string | undefined, place: number): TableColumn | undefined {
    const columns = ctx.columns();
    if (ref === undefined) return columns[place];
    const column = typeof ref === 'number' ? columns[ref] : columns.find((c) => c.key === ref);
    if (!column && columns.length > 0) {
        throw new Error(`[@sigx/lynx-zero] Table: column ${JSON.stringify(ref)} is not in Table.Root's columns (${columns.length} declared)`);
    }
    return column;
}

// ── Root ──

export type TableRootProps =
    /** The column spec: per column a `label`, a `width`, an `align`, `sortable`. */
    & Define.Prop<'columns', readonly TableColumn[], false>
    /** Stacked mode: `true`, or the breakpoint name the table stacks below (`'md'`). */
    & Define.Prop<'stack', string | boolean, false>
    /** The column the table is sorted by and its direction, or `null`. The runtime never re-orders rows. */
    & Define.Model<'sort', TableSort | null>
    & Define.Prop<'defaultSort', TableSort | null, false>
    & Define.Event<'sortChange', TableSort | null>
    /** `two` (default) flips ascending ⇄ descending; `three` adds a press back to unsorted. */
    & Define.Prop<'sortCycle', 'two' | 'three', false>
    /** `false` turns off the main-thread press feel on the sort triggers (the pressed flag stays). */
    & Define.Prop<'pressFeel', boolean, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    /** The skin's modifiers — daisy offers `zebra` and `hover`. */
    & Define.Prop<'mods', Record<string, boolean | undefined>, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

interface TableRootContext extends TableContext {
    pressFeel(): boolean;
}

const useTableRootExtras = defineInjectable<{ pressFeel(): boolean }>(() => ({ pressFeel: () => true }));

const TableRoot = component<TableRootProps>(({ props, slots, emit }) => {
    const sort = createControllableState<TableSort | null>(
        () => namedModel<TableSort | null>(props.sort),
        props.defaultSort ?? null,
        (value) => emit('sortChange', value),
    );
    const screen = useScreen();
    const stacked = (): boolean => tableStacks(props.stack, screen.value.width);
    const axes = provideVariantAxes((): VariantAxes => {
        const resolved = resolveVariantAxes(anatomy.scope, { color: props.color, size: props.size });
        const mods = { ...resolved.mods, ...props.mods };
        return { ...resolved, mods: stacked() ? { ...mods, stacked: true } : mods };
    });
    const ctx: TableRootContext = {
        columns: () => props.columns ?? [],
        stacked,
        sort: () => sort.value ?? null,
        toggleSort: (column) => { sort.value = nextTableSort(sort.value ?? null, column, props.sortCycle); },
        pressFeel: () => props.pressFeel !== false,
    };
    defineProvide(useTableContext, () => ctx);
    defineProvide(useTableRootExtras, () => ctx);

    return () => {
        const a = axes();
        const fixed = stacked() ? null : tableFixedWidth(ctx.columns());
        const rootBag = {
            ...partBag(anatomy, 'root', { ...partAxes(a), class: props.class }),
            // The breakpoint-valued layout attribute, as the web renders it.
            'data-l-stack': typeof props.stack === 'string' ? props.stack : undefined,
        };
        const table = (
            <view
                {...partBag(anatomy, 'table', partAxes(a))}
                style={fixed !== null ? { display: 'flex', flexDirection: 'column', width: `${fixed}px` } : { display: 'flex', flexDirection: 'column' }}
            >
                {slots.default?.()}
            </view>
        );
        // A table of fixed columns is as wide as their sum and scrolls in
        // its root — the web root's `overflow-x: auto`.
        return fixed !== null
            ? <scroll-view {...rootBag} scroll-orientation="horizontal" show-scrollbar={false}>{table}</scroll-view>
            : <view {...rootBag}>{table}</view>;
    };
}, { name: 'Table.Root' });

// ── Caption ──

export type TableCaptionProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

const TableCaption = component<TableCaptionProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <view {...partBag(anatomy, 'caption', { ...partAxes(axes()), class: props.class })}>
            {asText(slots.default?.(), undefined)}
        </view>
    );
}, { name: 'Table.Caption' });

// ── Sections ──

export type TablePartProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

/**
 * The head: the header row the app writes, or — with no children — one
 * built from the column spec's labels. Visually hidden (never removed) while
 * the table stacks.
 */
const TableHead = component<TablePartProps>(({ props, slots }) => {
    const ctx = useTableContext();
    const axes = useVariantAxes();
    return () => {
        const columns = ctx.columns();
        const children = slots.default?.();
        const empty = children === undefined || (Array.isArray(children) && children.length === 0);
        return (
            <view
                {...partBag(anatomy, 'head', { ...partAxes(axes()), class: props.class })}
                style={ctx.stacked() ? VISUALLY_HIDDEN : undefined}
            >
                {!empty ? children : columns.length > 0 ? (
                    <TableRow>
                        {columns.map((column, index) => (
                            <TableHeaderCell key={column.key ?? index} column={index} sortable={column.sortable} />
                        ))}
                    </TableRow>
                ) : null}
            </view>
        );
    };
}, { name: 'Table.Head' });

const section = (part: 'body' | 'foot', name: string) =>
    component<TablePartProps>(({ props, slots }) => {
        const axes = useVariantAxes();
        // Replaced, never mutated, so a join or a leave re-renders the rows.
        const rows = signal({ order: [] as number[] });
        if (part === 'body') {
            defineProvide(useSectionContext, () => ({
                register: (id: number) => {
                    rows.order = [...rows.order, id];
                    return () => { rows.order = rows.order.filter((other) => other !== id); };
                },
                place: (id: number) => rows.order.indexOf(id),
            }));
        }
        return () => (
            <view {...partBag(anatomy, part, { ...partAxes(axes()), class: props.class })}>
                {slots.default?.()}
            </view>
        );
    }, { name });

const TableBody = section('body', 'Table.Body');
const TableFoot = section('foot', 'Table.Foot');

// ── Row ──

export type TableRowProps =
    /** The app's "this row is chosen" — the shared `selected` flag. */
    & Define.Prop<'selected', boolean, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

interface CellEntry {
    id: number;
    span: () => number;
}

const TableRow = component<TableRowProps>(({ props, slots, onUnmounted }) => {
    const ctx = useTableContext();
    const body = useSectionContext();
    const axes = useVariantAxes();
    const id = ++nextId;
    onUnmounted(body.register(id));
    const cells = signal({ order: [] as CellEntry[] });
    defineProvide(useRowContext, () => ({
        register: (cellId: number, span: () => number) => {
            cells.order = [...cells.order, { id: cellId, span }];
            return () => { cells.order = cells.order.filter((c) => c.id !== cellId); };
        },
        place: (cellId: number) => {
            let place = 0;
            for (const cell of cells.order) {
                if (cell.id === cellId) return place;
                place += cell.span();
            }
            return place;
        },
    }));

    return () => {
        const a = partAxes(axes());
        const selected = !!props.selected;
        // The zebra stripe: every even body row (1-based) that is not
        // selected — the web's `:nth-child(even):not([data-selected])`.
        const place = body.place(id);
        const stripe = !!a.mods?.['zebra'] && place >= 0 && place % 2 === 1 && !selected;
        return (
            <view
                {...partBag(anatomy, 'row', {
                    flags: { selected },
                    ...a,
                    mods: { ...a.mods, stripe },
                    class: props.class,
                })}
                style={{ display: 'flex', flexDirection: ctx.stacked() ? 'column' : 'row' }}
            >
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'Table.Row' });

// ── Cells ──

/** The column a cell belongs to — an index into `columns`, or a column's `key`. */
type CellColumnProps =
    & Define.Prop<'column', number | string, false>
    /** How many columns the cell covers. Default 1. */
    & Define.Prop<'colSpan', number, false>;

/** Join the row's cell order; returns the cell's column place reader. */
function useCellPlace(onUnmounted: (fn: () => void) => void, span: () => number): () => number {
    const row = useRowContext();
    const id = ++nextId;
    onUnmounted(row.register(id, span));
    return () => row.place(id);
}

const spanOf = (colSpan: number | undefined): number =>
    Math.max(1, Math.floor(typeof colSpan === 'number' && Number.isFinite(colSpan) ? colSpan : 1));

/** A cell's box: its column width (not while stacked — a block has no columns) and its alignment. */
function cellStyle(ctx: TableContext, place: number, span: number, column: TableColumn | undefined): Record<string, string | number> {
    if (ctx.stacked()) return { display: 'flex', flexDirection: 'row', alignItems: 'flex-start' };
    const align = column?.align;
    return {
        ...tableCellBox(ctx.columns(), place, span),
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        ...(align ? { alignItems: ALIGN_ITEMS[align] } : {}),
    };
}

export type TableHeaderCellProps =
    /**
     * The column can sort the table: the content renders inside the
     * `sort-trigger`, and the cell carries the sort state. Sorts under the
     * cell's `column` — a string name, or the `key` of the spec column an
     * index names.
     */
    & Define.Prop<'sortable', boolean, false>
    /** Disables a sortable cell's trigger — the sort it shows stays. */
    & Define.Prop<'disabled', boolean, false>
    /** Accessible name of the sort trigger. Default: the content when it is text, else the column label. */
    & Define.Prop<'label', string, false>
    & CellColumnProps
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

/** The name a sortable header cell sorts under: its string `column`, else its spec column's `key`. */
function sortColumnOf(ref: number | string | undefined, column: TableColumn | undefined): string {
    const name = typeof ref === 'string' ? ref : column?.key;
    if (name === undefined) {
        throw new Error(`[@sigx/lynx-zero] Table: a sortable header cell needs a column name — a string \`column\`, or a spec column with a \`key\` (got ${JSON.stringify(ref)})`);
    }
    return name;
}

const DIRECTION_WORDS: Record<TableSortDirection, string> = { ascending: 'sorted ascending', descending: 'sorted descending' };

const TableHeaderCell = component<TableHeaderCellProps>(({ props, slots, onUnmounted }) => {
    const ctx = useTableContext();
    const extras = useTableRootExtras();
    const axes = useVariantAxes();
    const place = useCellPlace(onUnmounted, () => spanOf(props.colSpan));
    const press = createPressFeedback({ isDisabled: () => props.disabled === true, feel: extras.pressFeel() });

    return () => {
        const a = partAxes(axes());
        const at = place();
        const specless = props.sortable && typeof props.column === 'string' && ctx.columns().length === 0;
        const column = specless ? undefined : columnOf(ctx, props.column, at);
        const content = slots.default?.() ?? column?.label;
        let state: 'ascending' | 'descending' | 'none' | undefined;
        let name = '';
        if (props.sortable) {
            name = sortColumnOf(props.column, column);
            const current = ctx.sort();
            state = current?.column === name ? current.direction : 'none';
        }
        const style = cellStyle(ctx, at, spanOf(props.colSpan), column);
        if (!state) {
            return (
                <view {...partBag(anatomy, 'header-cell', { ...a, class: props.class })} style={style}>
                    {asText(content, column?.align)}
                </view>
            );
        }
        const disabled = props.disabled === true;
        const forced = a.forced && (!a.forced.parts || a.forced.parts.includes('sort-trigger')) ? a.forced.flags : undefined;
        // The unsorted mark shows while its trigger is held — the web's
        // hover/focus reveal, on a touch screen.
        const held = press.pressed() || !!forced?.['pressed'] || !!forced?.['focus-visible'];
        const text = plainText(content) ?? column?.label;
        // Never an unnamed button: the column's sort name is the last resort.
        const label = props.label ?? text ?? name;
        const spoken = state === 'none' ? label : [label, DIRECTION_WORDS[state]].filter(Boolean).join(', ');
        return (
            <view {...partBag(anatomy, 'header-cell', { ...a, state, class: props.class })} style={style}>
                <view
                    {...partBag(anatomy, 'sort-trigger', { ...a, state, flags: { disabled, pressed: press.pressed() } })}
                    {...partA11y({ trait: 'button', label: spoken, disabled })}
                    style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}
                    bindtap={() => {
                        if (!disabled) ctx.toggleSort(name);
                    }}
                    {...press.handlers}
                >
                    {asText(content, column?.align)}
                    <text
                        {...partBag(anatomy, 'sort-indicator', { ...a, state, mods: { ...a.mods, held } })}
                        accessibility-element={false}
                    >
                        ▲
                    </text>
                </view>
            </view>
        );
    };
}, { name: 'Table.HeaderCell' });

export type TableCellProps =
    & CellColumnProps
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

/**
 * A data cell. On a stacked table it opens with its column's label (the
 * `cell-label` part) — from the column it names, or the one at its place.
 */
const TableCell = component<TableCellProps>(({ props, slots, onUnmounted }) => {
    const ctx = useTableContext();
    const axes = useVariantAxes();
    const place = useCellPlace(onUnmounted, () => spanOf(props.colSpan));

    return (): JSXElement => {
        const a = partAxes(axes());
        const at = place();
        const column = columnOf(ctx, props.column, at);
        const label = ctx.stacked() ? column?.label : undefined;
        return (
            <view {...partBag(anatomy, 'cell', { ...a, class: props.class })} style={cellStyle(ctx, at, spanOf(props.colSpan), column)}>
                {label ? (
                    <text
                        {...partBag(anatomy, 'cell-label', a)}
                        // The label column of a stacked line (the web's 8rem float).
                        style={{ width: '128px', flexShrink: 0, marginRight: '8px' }}
                        accessibility-element={false}
                    >
                        {label}
                    </text>
                ) : null}
                {asText(slots.default?.(), label ? undefined : column?.align)}
            </view>
        );
    };
}, { name: 'Table.Cell' });

export const Table = compound(TableRoot, {
    Root: TableRoot,
    Caption: TableCaption,
    Head: TableHead,
    Body: TableBody,
    Foot: TableFoot,
    Row: TableRow,
    HeaderCell: TableHeaderCell,
    Cell: TableCell,
});
