import {
    component,
    runOnMainThread,
    signal,
    useFontScale,
    useMainThreadRef,
    type Define,
    type MainThread,
} from '@sigx/lynx';
import { List, SCROLL_METHOD, type ListRef } from '@sigx/lynx-list';
import type { EmojiDatum, SkinTone } from '../data/schema.js';
import { glyphForTone } from '../data/glyph.js';
import type { EmojiRenderCell } from '../types.js';
import { EmojiCell, emojiCellRow, emojiRowPx } from './EmojiCell.js';
import { HEADER_PX, sectionHeaderRow } from './SectionHeader.js';

/** One section of a sectioned grid: a labeled header + its emoji. */
export interface EmojiSection {
    /** Stable key (category key, `'recents'`, …) — also the tab identity. */
    readonly key: string;
    /** Header label. */
    readonly label: string;
    readonly emojis: readonly EmojiDatum[];
}

/** A row of the sectioned grid: a sticky header or one emoji cell. */
type SectionRow =
    | { readonly header: true; readonly key: string; readonly label: string }
    | { readonly header?: false; readonly datum: EmojiDatum; readonly section: string };

/**
 * Flat cell index of `key`'s header row — what to hand
 * `ListMethods.scrollToIndex` (or the picker's scroll worklet) for a section
 * jump. Each section occupies `1 + emojis.length` cells. Returns -1 for an
 * unknown key.
 */
export function sectionRowIndex(sections: readonly EmojiSection[], key: string): number {
    let index = 0;
    for (const section of sections) {
        if (section.key === key) return index;
        index += 1 + section.emojis.length;
    }
    return -1;
}

/**
 * Pixel offset each section's header starts at, in section order — exact, not
 * estimated: headers are `HEADER_PX` tall and emoji rows `emojiRowPx(size)`,
 * `ceil(n / columns)` rows per section, so the math IS the layout.
 */
export function sectionStartOffsets(
    sections: readonly EmojiSection[],
    columns: number,
    cellSize?: number,
): number[] {
    const rowPx = emojiRowPx(cellSize);
    const offsets: number[] = [];
    let y = 0;
    for (const section of sections) {
        offsets.push(y);
        y += HEADER_PX + Math.ceil(section.emojis.length / columns) * rowPx;
    }
    return offsets;
}

/**
 * Ref-like channel for imperative section scrolls — the GRID owns the scroll
 * because only it knows how much of the dataset is staged (#666): a raw
 * `scrollToPosition` at an unstaged index is silently DROPPED by native, so
 * a fast tab tap right after open would die. The grid registers its
 * staged-aware handler here at setup; owners call `current?.(sectionKey)`.
 */
export type EmojiGridScrollHandle = { current: ((sectionKey: string) => void) | null };

/** Rows staged synchronously at mount — ~2.5 viewports at default sizing. */
const STAGE_INITIAL = 240;
/** Per-slice BG budget. Slices adapt their row count to stay near this. */
const STAGE_SLICE_BUDGET_MS = 14;

/**
 * Cooperative staging driver (#666): reveals an item count in budgeted
 * slices. Each slice is scheduled as its own macrotask, so event handlers
 * run between slices and every slice's ops ship as a bounded batch; the
 * slice size adapts to the measured wall cost of the previous slice
 * (targeting {@link STAGE_SLICE_BUDGET_MS}). Deliberately not hardwired to
 * "visible now": any owner of a rows array can drive it — including a warm
 * pre-stage of a hidden picker through idle frames (#651).
 */
export function createStagingDriver(initial: number): {
    /** Reactive staged-count — slice items to this in render. */
    staged: { value: number };
    /** Keep slicing until `total` rows are staged (idempotent per tick). */
    ensure(total: number): void;
    /** Back to the initial slice (dataset identity changed). */
    reset(): void;
} {
    const staged = signal(initial);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const INITIAL_SLICE_ROWS = 96;
    let sliceRows = INITIAL_SLICE_ROWS;
    let sliceStartedAt = 0;
    let sliceStartedCount = 0;
    const ensure = (total: number): void => {
        if (timer !== undefined || staged.value >= total) return;
        timer = setTimeout(() => {
            timer = undefined;
            const now = Date.now();
            // Adapt: wall time of the previous slice (its write + render +
            // reconcile + ops all happen before this macrotask runs) vs the
            // budget. Clamped so a hiccup can't stall or explode staging.
            if (sliceStartedAt > 0) {
                const grew = staged.value - sliceStartedCount;
                const cost = Math.max(1, now - sliceStartedAt);
                const perRow = cost / Math.max(1, grew);
                sliceRows = Math.max(24, Math.min(512, Math.round(STAGE_SLICE_BUDGET_MS / perRow)));
            }
            sliceStartedAt = now;
            sliceStartedCount = staged.value;
            staged.value = Math.min(staged.value + sliceRows, total);
        }, 0);
    };
    return {
        staged,
        ensure,
        reset() {
            // Cancel any in-flight slice FIRST: a stale callback would both
            // mutate `staged` for the previous dataset and (with only a
            // pending flag) block the new dataset's first slice from being
            // scheduled by the same render that reset us.
            if (timer !== undefined) {
                clearTimeout(timer);
                timer = undefined;
            }
            staged.value = initial;
            sliceStartedAt = 0;
            // The adaptive size was tuned for the PREVIOUS dataset's rows —
            // carried over, a 512-row first slice could blow the budget.
            sliceRows = INITIAL_SLICE_ROWS;
        },
    };
}

export type EmojiGridProps =
    /** The emoji to show (search hits, a single category…). */
    & Define.Prop<'emojis', EmojiDatum[], false>
    /**
     * Sectioned mode: ONE continuous scroll over every section with a sticky
     * full-span header per section — a category jump is a scroll, not a
     * re-mount (`sectionRowIndex` maps a key to the scroll target). Takes
     * precedence over `emojis`. Emits `activeSection` (throttled by the
     * list's scroll events) as the topmost section changes under the sticky
     * header, so a tab bar can follow the scroll.
     */
    & Define.Prop<'sections', readonly EmojiSection[], false>
    /**
     * Dataset identity. Flat mode: change it when the grid is handed a
     * *different* `emojis` dataset (a new search query) so the grid
     * re-anchors to the top instead of keeping the old scroll position; omit
     * for in-place updates. Sectioned mode: keys the internal row/offset
     * cache — `sections` content is treated as FIXED per key (hand the grid
     * a new key for a different sections dataset). No re-anchor in sectioned
     * mode: List's re-anchor machinery would claim the native element's
     * single main-thread ref and starve `mtRef` (scroll-to-section).
     */
    & Define.Prop<'itemsKey', string, false>
    /** Capture the native `<list>` element — for imperative scroll-to-section. */
    & Define.Prop<'mtRef', ListRef, false>
    /**
     * Sectioned mode: registers the grid's STAGED-AWARE scroll-to-section
     * handler (see {@link EmojiGridScrollHandle}). Prefer this over raw
     * `ListMethods.scrollToIndex` — a target beyond the staged rows becomes
     * a pending scroll that fires the moment staging reaches it (latest
     * request wins; a manual scroll cancels it).
     */
    & Define.Prop<'scrollHandle', EmojiGridScrollHandle, false>
    /**
     * Known height (px) of the grid's box, used to lay the native list out at
     * full size on its very first frame (forwarded to
     * `List.initialMainAxisSize`). Without it a freshly mounted grid spends a
     * frame at a 1px placeholder and visibly re-lays-out once measured.
     */
    & Define.Prop<'initialHeight', number, false>
    /** Sticky skin tone applied to every tonal cell. Default 0 (base). */
    & Define.Prop<'tone', SkinTone, false>
    /** Grid columns. Default 8. */
    & Define.Prop<'columns', number, false>
    /** Glyph font size. Default 32. */
    & Define.Prop<'cellSize', number, false>
    & Define.Prop<'class', string, false>
    & Define.Prop<'cellClass', string, false>
    & Define.Prop<'headerClass', string, false>
    /** Section header label font size (the picker scales it with the grid). */
    & Define.Prop<'headerLabelSize', number, false>
    & Define.Prop<'renderCell', EmojiRenderCell, false>
    & Define.Prop<'style', Record<string, string | number>, false>
    & Define.Event<'pick', EmojiDatum>
    & Define.Event<'pickTone', EmojiDatum>
    /** Sectioned mode only: the section whose band the viewport top is in. */
    & Define.Event<'activeSection', string>;

/**
 * The headless grid — a `List` in flow layout running TEMPLATE cells (#649).
 * Every row is a staged snapshot-template record: the main thread builds a
 * cell synchronously the moment the native recycler pulls it and recycles
 * offscreen cell trees through the template pool, so the full dataset ships
 * as data with no windowing and no per-cell background rendering on scroll.
 *
 * Flat mode (`emojis`) renders one dataset; sectioned mode (`sections`)
 * renders every section into a single list with sticky headers (#662) —
 * WhatsApp-style. In sectioned mode each cell's `item-key` is prefixed with
 * its section key: recents repeat emojis their home category also shows, and
 * native item-keys must be unique per list.
 *
 * Layout: `class`/`style` pass through to `List`'s measuring wrapper, so
 * flex sizing works as usual (`style={{ flexGrow: 1 }}` in a column — avoid
 * the inline `flex` shorthand; iOS Lynx 3.8 doesn't expand it).
 */
export const EmojiGrid = component<EmojiGridProps>(({ props, emit }) => {
    // Setup scope: identity-stable across renders, so List's render only
    // re-runs for real changes. `props` is a stable reactive proxy — reading
    // props.* inside these stays live.
    const keyExtractor = (d: EmojiDatum): string => d.e;
    const renderItem = (datum: EmojiDatum): unknown => (
        <EmojiCell
            datum={datum}
            glyph={glyphForTone(datum, props.tone ?? 0)}
            size={props.cellSize}
            class={props.cellClass}
            render={props.renderCell}
            onPick={(d) => emit('pick', d)}
            onPickTone={(d) => emit('pickTone', d)}
        />
    );

    const rowKey = (row: SectionRow): string =>
        row.header ? `hdr:${row.key}` : `${row.section}:${row.datum.e}`;
    // Sectioned rows are PLAIN template vnodes, not components: a
    // `component()` instance per row (proxies + effect + lifecycle) is what
    // made the ~1,900-row mount take seconds on device (#666). The reconciler
    // keys rows by item-key; event signs stay stable per snapshot instance.
    // The `render`-prop escape hatch still routes through the EmojiCell
    // component (its slot-bearing branch needs one).
    const emitPick = (d: EmojiDatum): void => emit('pick', d);
    const emitPickTone = (d: EmojiDatum): void => emit('pickTone', d);
    // Picker rows are PINNED against the OS font scale (#776) — glyph/label
    // fontSize is counter-divided so the est==actual row geometry holds.
    const fontScale = useFontScale();
    const renderRow = (row: SectionRow): unknown => {
        if (row.header) {
            return sectionHeaderRow({ itemKey: `hdr:${row.key}`, label: row.label, class: props.headerClass, labelSize: props.headerLabelSize, fontScale: fontScale.value });
        }
        if (props.renderCell) {
            return (
                <EmojiCell
                    datum={row.datum}
                    itemKey={rowKey(row)}
                    glyph={glyphForTone(row.datum, props.tone ?? 0)}
                    size={props.cellSize}
                    class={props.cellClass}
                    render={props.renderCell}
                    onPick={emitPick}
                    onPickTone={emitPickTone}
                />
            );
        }
        return emojiCellRow({
            datum: row.datum,
            glyph: glyphForTone(row.datum, props.tone ?? 0),
            itemKey: rowKey(row),
            size: props.cellSize,
            fontScale: fontScale.value,
            class: props.cellClass,
            onPick: emitPick,
            onPickTone: emitPickTone,
        });
    };

    // Rows/offsets are cached against STABLE keys, not the array identity —
    // prop reads come back as proxies that are never `===` the source, so an
    // identity check would miss every time (and recompute ~2k rows per scroll
    // event). Contract mirrors `emojis`+`itemsKey`: the sections dataset is
    // fixed per `itemsKey`; hand the grid a new key for a different dataset.
    let rowsCache: { key: string; columns: number; size: number | undefined; rows: SectionRow[]; offsets: number[] } | null = null;
    const composed = (sections: readonly EmojiSection[], columns: number): { rows: SectionRow[]; offsets: number[] } => {
        const cacheKey = props.itemsKey ?? '';
        if (
            !rowsCache
            || rowsCache.key !== cacheKey
            || rowsCache.columns !== columns
            || rowsCache.size !== props.cellSize
        ) {
            const rows: SectionRow[] = [];
            for (const section of sections) {
                rows.push({ header: true, key: section.key, label: section.label });
                for (const datum of section.emojis) rows.push({ datum, section: section.key });
            }
            rowsCache = {
                key: cacheKey,
                columns,
                size: props.cellSize,
                rows,
                offsets: sectionStartOffsets(sections, columns, props.cellSize),
            };
        }
        return rowsCache;
    };

    // Row VNODES are cached per (dataset, tone, sizing, theming) key: a
    // re-render of the List for ANY reason then hands the reconciler the
    // IDENTICAL vnode per row, and the per-row diff short-circuits (props
    // compare `===`, event holes keep their closures) — without this, every
    // stray re-render re-created ~1,900 vnodes + closures and cost ~1s of
    // reconcile on device (#666; same lesson as the #617 chunked mount).
    // Tone/size/class changes rotate the cache key: a REAL re-patch pass.
    let vnodeCache: { key: string; map: Map<string, unknown> } | null = null;
    const rowVnode = (row: SectionRow): unknown => {
        if (props.renderCell) return renderRow(row);   // custom cells: uncached
        // fontScale in the key: a live OS text-size change must rebuild the
        // cached vnodes so their counter-divided fontSize re-pins (#776).
        const ck = `${props.itemsKey ?? ''}|${props.tone ?? 0}|${props.cellSize ?? ''}|${props.cellClass ?? ''}|${props.headerClass ?? ''}|${props.headerLabelSize ?? ''}|${props.columns ?? 8}|${fontScale.value}`;
        if (!vnodeCache || vnodeCache.key !== ck) vnodeCache = { key: ck, map: new Map() };
        const k = rowKey(row);
        let v = vnodeCache.map.get(k);
        if (v === undefined) {
            v = renderRow(row);
            vnodeCache.map.set(k, v);
        }
        return v;
    };

    // CHUNKED, BUDGETED STAGING (#666): the first paint needs only ~2
    // viewports of rows; the rest streams in COOPERATIVE slices. Every slice
    // must leave the BG thread responsive (event handlers run between
    // slices) and ship a bounded ops batch (the MT interpreter applies each
    // in a few ms instead of stalling touch on one giant batch). The slice
    // size adapts to the measured cost of the previous slice so each stays
    // near the frame budget on whatever device runs it. The vnode cache
    // above makes re-passes over already-staged rows cache hits; appends
    // land as pure list-end INSERTs. A tab tap before staging completes
    // clamps to the staged bottom and the tab-follow self-corrects.
    const driver = createStagingDriver(STAGE_INITIAL);
    const stagedRows = driver.staged;
    let stagedKey = '';

    // Staged-aware scroll-to-section (#666). The MT invoke is inlined and
    // `method` passed as an ARG: worklet `_c` capture does not carry
    // imported function refs, so `ListMethods.*` in here would silently
    // no-op. The ref the worklet captures is resolved ONCE at setup —
    // the consumer's `mtRef` when given, else the grid's own.
    const ownListRef = useMainThreadRef<MainThread.Element | null>(null);
    const scrollRef = props.mtRef ?? ownListRef;
    const scrollToRow = runOnMainThread((rowIndex: number, method: string) => {
        'main thread';
        const el = scrollRef.current;
        if (!el || rowIndex < 0) return;
        const p = el.invoke(method, { position: rowIndex, alignTo: 'top', offset: 0, smooth: false });
        if (p && typeof p.catch === 'function') p.catch(() => { /* stale el: no-op */ });
    });
    let pendingScrollKey: string | null = null;
    let pendingFireTimer: ReturnType<typeof setTimeout> | undefined;
    let lastScrollOffset = 0;
    /**
     * Staged rows needed for an align-top scroll to `row` to LAND there:
     * the target itself plus a viewport of content below it — with less,
     * native clamps to the staged bottom and the header sits mid-screen.
     * (Capped at the full row count: the tail sections can never have a
     * whole viewport below them.)
     */
    const stagedNeededFor = (row: number, sections: readonly EmojiSection[]): number => {
        const cols = props.columns ?? 8;
        const viewportPx = frozenInitialHeight ?? 640;
        const slack = (Math.ceil(viewportPx / emojiRowPx(props.cellSize)) + 1) * cols;
        const total = sections.length + sections.reduce((n, sec) => n + sec.emojis.length, 0);
        return Math.min(total, row + slack);
    };
    const requestSectionScroll = (key: string): void => {
        const sections = props.sections;
        if (!sections) return;
        const row = sectionRowIndex(sections, key);
        if (row < 0) return;
        if (stagedNeededFor(row, sections) <= stagedRows.value) {
            pendingScrollKey = null;
            void scrollToRow(row, SCROLL_METHOD);
        } else {
            // Not enough staged content for the jump to land: native would
            // DROP or clamp the scroll. Park it; the render pass that stages
            // far enough fires it (latest request wins, manual scrolling
            // cancels).
            pendingScrollKey = key;
        }
    };
    if (props.scrollHandle) props.scrollHandle.current = requestSectionScroll;

    // `initialHeight` sizes the list's FIRST frame only — but the measuring
    // region keeps reporting slightly different heights as siblings settle
    // (633 -> 607 -> 610 on device), and every change would re-render List
    // and remap all ~1,900 rows (#666). Freeze the first real value; native
    // flex layout owns the size from then on.
    let frozenInitialHeight: number | undefined;
    let initialHeightFrozen = false;
    const initialMainAxisSize = (): number | undefined => {
        if (!initialHeightFrozen) {
            frozenInitialHeight = props.initialHeight;
            initialHeightFrozen = frozenInitialHeight !== undefined;
        }
        return frozenInitialHeight;
    };

    let lastActive: string | null = null;
    const onScroll = (offset: number): void => {
        // Genuine user movement while a section scroll is parked = the user
        // changed their mind; drop the pending target (repeat offsets from
        // native's throttled stream don't count).
        if (pendingScrollKey !== null && Math.abs(offset - lastScrollOffset) > 4) {
            pendingScrollKey = null;
        }
        lastScrollOffset = offset;
        const sections = props.sections;
        if (!sections || sections.length === 0) return;
        const { offsets } = composed(sections, props.columns ?? 8);
        // Active = the section whose band the viewport top sits in, judged at
        // the sticky header's midline so the switch lands as the incoming
        // header pushes the pinned one away (not a full header early/late).
        const probe = offset + HEADER_PX / 2;
        let active = 0;
        for (let i = 1; i < offsets.length; i++) {
            if (offsets[i]! <= probe) active = i;
            else break;
        }
        const key = sections[active]!.key;
        if (key !== lastActive) {
            lastActive = key;
            emit('activeSection', key);
        }
    };
    // Identity-stable listener: a fresh closure per render would change
    // List's props every grid re-render and re-run its 1,913-row map.
    const onListScroll = (e: { offset: number }): void => onScroll(e.offset);

    return () => {
        const sections = props.sections;
        if (sections !== undefined) {
            const { rows } = composed(sections, props.columns ?? 8);
            const stageKey = props.itemsKey ?? '';
            if (stageKey !== stagedKey) {
                stagedKey = stageKey;
                driver.reset();
                // A parked/queued section scroll belongs to the OLD dataset —
                // its key may not exist (or mean something else) in the new
                // one. Cancel the intent along with the staging.
                pendingScrollKey = null;
                if (pendingFireTimer !== undefined) {
                    clearTimeout(pendingFireTimer);
                    pendingFireTimer = undefined;
                }
            }
            const stagedCount = Math.min(stagedRows.value, rows.length);
            const items = stagedCount < rows.length ? rows.slice(0, stagedCount) : rows;
            if (stagedCount < rows.length) driver.ensure(rows.length);
            if (pendingScrollKey !== null && pendingFireTimer === undefined) {
                const row = sectionRowIndex(sections, pendingScrollKey);
                if (row < 0) {
                    pendingScrollKey = null;
                } else if (stagedNeededFor(row, sections) <= stagedCount) {
                    // One macrotask later: the slice's ops batch (and its
                    // update-list-info) must reach native BEFORE the scroll
                    // or the index is still out of range and dropped. The
                    // pending key stays SET until the callback runs so the
                    // cancel semantics hold through the deferral window: a
                    // manual scroll nulls it (callback no-ops) and a newer
                    // tap retargets it (callback re-validates: fires if the
                    // new target is coverable, else leaves it parked for its
                    // own crossing).
                    pendingFireTimer = setTimeout(() => {
                        pendingFireTimer = undefined;
                        if (pendingScrollKey === null) return;   // cancelled in the window
                        const sectionsNow = props.sections;
                        if (!sectionsNow) { pendingScrollKey = null; return; }
                        const rowNow = sectionRowIndex(sectionsNow, pendingScrollKey);
                        if (rowNow < 0) { pendingScrollKey = null; return; }
                        if (stagedNeededFor(rowNow, sectionsNow) > stagedRows.value) return;
                        pendingScrollKey = null;
                        void scrollToRow(rowNow, SCROLL_METHOD);
                    }, 32);
                }
            }
            return (
                <List
                    items={items}
                    // NO itemsKey here — the sectioned dataset is static per
                    // mount, so List's swap-re-anchor machinery has nothing to
                    // do (and its anchor worklet shares the single native ref
                    // with `mtRef` consumers — keep it out of the picture).
                    // `props.itemsKey` still keys the rows cache above.
                    initialMainAxisSize={initialMainAxisSize()}
                    keyExtractor={rowKey}
                    templateCells
                    renderItem={rowVnode}
                    listType="flow"
                    numColumns={props.columns ?? 8}
                    sticky
                    mtRef={scrollRef}
                    class={props.class}
                    style={props.style}
                    onScroll={onListScroll}
                />
            );
        }
        return (
            <List
                items={props.emojis ?? []}
                itemsKey={props.itemsKey}
                initialMainAxisSize={props.initialHeight}
                keyExtractor={keyExtractor}
                templateCells
                renderItem={renderItem}
                listType="flow"
                numColumns={props.columns ?? 8}
                class={props.class}
                style={props.style}
            />
        );
    };
});
