import { component, type Define } from '@sigx/lynx';
import { List } from '@sigx/lynx-list';
import type { EmojiDatum, SkinTone } from '../data/schema.js';
import { glyphForTone } from '../data/glyph.js';
import type { EmojiRenderCell } from '../types.js';
import { EmojiCell } from './EmojiCell.js';

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
    /** Glyph font size. Default 32. */
    & Define.Prop<'cellSize', number, false>
    & Define.Prop<'class', string, false>
    & Define.Prop<'cellClass', string, false>
    & Define.Prop<'renderCell', EmojiRenderCell, false>
    & Define.Prop<'style', Record<string, string | number>, false>
    & Define.Event<'pick', EmojiDatum>
    & Define.Event<'pickTone', EmojiDatum>;

/**
 * The headless grid — a `List` in flow layout running TEMPLATE cells (#649).
 * Every row is a staged snapshot-template record: the main thread builds a
 * cell synchronously the moment the native recycler pulls it and recycles
 * offscreen cell trees through the template pool, so the full category ships
 * as data with no windowing and no per-cell background rendering on scroll.
 * (The pre-template windowed setup — #603-era mounted-cell budgets — is gone.)
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

    return () => (
        <List
            items={props.emojis}
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
});
