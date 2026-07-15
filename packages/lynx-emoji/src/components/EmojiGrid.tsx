import { component, type Define } from '@sigx/lynx';
import { List } from '@sigx/lynx-list';
import type { EmojiDatum, SkinTone } from '../data/schema.js';
import { glyphForTone } from '../data/glyph.js';
import type { EmojiRenderCell } from '../types.js';
import { EmojiCell } from './EmojiCell.js';

// Window sizing in ROWS so the mounted-cell budget tracks the column count.
// Kept DELIBERATELY SMALL: the native list produces invalid layout — blank or
// displaced content, racy and no JS error — once roughly 130-150+ cells are
// mounted at once (#603; reproducible with no emoji code at all by raising the
// List showcase demo's window to ~250). At 8 columns this is 64 cells
// initially and 96 at full expansion, measured to render reliably where 120/240
// did not. Do NOT raise these without re-testing on device.
const ROWS_INITIAL = 8;
const ROWS_PAGE = 4;
const ROWS_MAX = 12;

export type EmojiGridProps =
    /** The emoji to show (one category, search hits, recents…). */
    & Define.Prop<'emojis', EmojiDatum[], true>
    /**
     * Identity of the `emojis` dataset — change it when the grid is handed a
     * *different* dataset (a category/tab switch, a new search query) so the
     * grid re-anchors to the top instead of keeping the old scroll position.
     * Omit for in-place updates to the same dataset.
     */
    & Define.Prop<'itemsKey', string, false>
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
    /** Glyph font size. Default 26. */
    & Define.Prop<'cellSize', number, false>
    & Define.Prop<'class', string, false>
    & Define.Prop<'cellClass', string, false>
    & Define.Prop<'renderCell', EmojiRenderCell, false>
    & Define.Prop<'style', Record<string, string | number>, false>
    & Define.Event<'pick', EmojiDatum>
    & Define.Event<'pickTone', EmojiDatum>;

/**
 * The headless grid — a windowed `List` (`@sigx/lynx-list`) in flow layout.
 * The native recycler keeps the on-screen view count constant while
 * scrolling, and windowing bounds how many `<list-item>` subtrees are ever
 * *built* — the runtime materializes every rendered cell eagerly (only
 * native views recycle), so without it a switch to a large category would
 * rebuild hundreds of cell subtrees in one pass.
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
    const itemType = (): string => 'emoji';
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

    return () => {
        const cols = props.columns ?? 8;
        return (
            <List
                items={props.emojis}
                itemsKey={props.itemsKey}
                initialMainAxisSize={props.initialHeight}
                keyExtractor={keyExtractor}
                itemType={itemType}
                renderItem={renderItem}
                listType="flow"
                numColumns={cols}
                // Default cell: 6+6px padding + the glyph at ~1.2 line-height.
                estimatedItemSize={Math.round((props.cellSize ?? 26) * 1.2) + 12}
                // List resolves the window config once at setup, so a
                // post-mount `columns` change won't rescale the window —
                // acceptable, columns are effectively fixed per mount.
                windowSize={cols * ROWS_INITIAL}
                pageSize={cols * ROWS_PAGE}
                maxWindow={cols * ROWS_MAX}
                class={props.class}
                style={props.style}
            />
        );
    };
});
