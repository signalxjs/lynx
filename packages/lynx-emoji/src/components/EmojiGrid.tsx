import { component, type Define } from '@sigx/lynx';
import { List, type ListRef } from '@sigx/lynx-list';
import type { EmojiDatum, SkinTone } from '../data/schema.js';
import { glyphForTone } from '../data/glyph.js';
import type { EmojiRenderCell } from '../types.js';
import { EmojiCell, emojiRowPx } from './EmojiCell.js';
import { HEADER_PX, SectionHeader } from './SectionHeader.js';

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
     * Identity of the `emojis` dataset — change it when the grid is handed a
     * *different* dataset (a new search query) so the grid re-anchors to the
     * top instead of keeping the old scroll position. Omit for in-place
     * updates to the same dataset.
     */
    & Define.Prop<'itemsKey', string, false>
    /** Capture the native `<list>` element — for imperative scroll-to-section. */
    & Define.Prop<'mtRef', ListRef, false>
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
    const renderRow = (row: SectionRow): unknown =>
        row.header
            ? <SectionHeader itemKey={`hdr:${row.key}`} label={row.label} class={props.headerClass} />
            : (
                <EmojiCell
                    datum={row.datum}
                    itemKey={rowKey(row)}
                    glyph={glyphForTone(row.datum, props.tone ?? 0)}
                    size={props.cellSize}
                    class={props.cellClass}
                    render={props.renderCell}
                    onPick={(d) => emit('pick', d)}
                    onPickTone={(d) => emit('pickTone', d)}
                />
            );

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

    let lastActive: string | null = null;
    const onScroll = (offset: number): void => {
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

    return () => {
        const sections = props.sections;
        if (sections !== undefined) {
            const { rows } = composed(sections, props.columns ?? 8);
            return (
                <List
                    items={rows}
                    // NO itemsKey here — List's re-anchor machinery claims the
                    // native element's single main-thread ref when itemsKey is
                    // set, silently starving `mtRef` (scroll-to-section then
                    // no-ops on a null ref — #663 device gate). The sectioned
                    // dataset is static per mount, so nothing needs re-anchor;
                    // `props.itemsKey` still keys the rows cache above.
                    initialMainAxisSize={props.initialHeight}
                    keyExtractor={rowKey}
                    templateCells
                    renderItem={renderRow}
                    listType="flow"
                    numColumns={props.columns ?? 8}
                    sticky
                    mtRef={props.mtRef}
                    class={props.class}
                    style={props.style}
                    onScroll={(e) => onScroll(e.offset)}
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
