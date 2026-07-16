import { component, type Define } from '@sigx/lynx';
import type { EmojiDatum } from '../data/schema.js';
import type { EmojiRenderCell } from '../types.js';

/**
 * Row height (px) a cell of `size` occupies: 6+6px padding + the glyph at
 * ~1.2 line-height. This is both the cell's `estimated-main-axis-size-px`
 * and the exact per-row height the sectioned grid's scroll-offset math uses
 * (fixed-height cells make section offsets arithmetic, not measurement).
 */
export const emojiRowPx = (size?: number): number => Math.round((size ?? 32) * 1.2) + 12;

export type EmojiCellProps =
    & Define.Prop<'datum', EmojiDatum, true>
    /** Tone-resolved glyph to render (the caller applies the sticky tone). */
    & Define.Prop<'glyph', string, true>
    /**
     * `item-key` override. Default is the base emoji (`datum.e`) — pass a
     * unique key when the same emoji can appear more than once in one list
     * (a sectioned picker shows recents AND their home category).
     */
    & Define.Prop<'itemKey', string, false>
    /** Glyph font size. Default 32. */
    & Define.Prop<'size', number, false>
    & Define.Prop<'class', string, false>
    /**
     * Custom cell content. NOTE: render-prop cells are slot-bearing templates
     * — they build synchronously like default cells but are excluded from
     * recycling (each keeps a dedicated tree); the default glyph cell pools.
     */
    & Define.Prop<'render', EmojiRenderCell, false>
    & Define.Event<'pick', EmojiDatum>
    /** Long-press on a tonal emoji (only emitted when variants exist). */
    & Define.Event<'pickTone', EmojiDatum>;

/**
 * One grid cell — a self-contained `<list-item>` snapshot template (#649).
 *
 * The default shape compiles to a ZERO-SLOT template (the glyph is a `text`
 * ATTRIBUTE hole, not a child), so under `List`'s `templateCells` the cell is
 * staged as a record, built synchronously on the main thread when pulled, and
 * RECYCLED through the template pool. Tap picks; long-press asks for the
 * skin-tone popover when the emoji has uniform tone variants.
 *
 * `item-key` is the base emoji (`datum.e`) — deliberately tone-free, so a
 * sticky-tone change re-patches every cell's glyph hole in place instead of
 * removing and re-inserting the whole dataset.
 */
export const EmojiCell = component<EmojiCellProps>(({ props, emit }) => {
    const onTap = (): void => emit('pick', props.datum);
    const onLongPress = (): void => {
        if (props.datum.s) emit('pickTone', props.datum);
    };
    const estRowPx = (): number => emojiRowPx(props.size);

    return () => props.render
        ? (
            // Render-prop branch: a SEPARATE template whose content is a slot —
            // functional but non-poolable (see the prop's TSDoc). Kept apart
            // from the default shape so default cells stay slot-free.
            <list-item
                item-key={props.itemKey ?? props.datum.e}
                item-type="emoji-custom"
                estimated-main-axis-size-px={estRowPx()}
                class={props.class}
                accessibility-element={true}
                accessibility-label={props.datum.n}
                accessibility-trait="button"
                bindtap={onTap}
                bindlongpress={onLongPress}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    // Height is PINNED to the estimate (not padding-derived):
                    // the native size estimate and the sectioned grid's
                    // scroll-offset math both assume emojiRowPx exactly —
                    // measured drift (~45px real vs 50 estimated) made
                    // tab-follow lag whole sections (#663 device gate).
                    height: `${estRowPx()}px`,
                }}
            >
                {props.render(props.datum, props.glyph)}
            </list-item>
        )
        : (
            <list-item
                item-key={props.itemKey ?? props.datum.e}
                item-type="emoji"
                estimated-main-axis-size-px={estRowPx()}
                class={props.class}
                accessibility-element={true}
                accessibility-label={props.datum.n}
                accessibility-trait="button"
                bindtap={onTap}
                bindlongpress={onLongPress}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    // Height is PINNED to the estimate (not padding-derived):
                    // the native size estimate and the sectioned grid's
                    // scroll-offset math both assume emojiRowPx exactly —
                    // measured drift (~45px real vs 50 estimated) made
                    // tab-follow lag whole sections (#663 device gate).
                    height: `${estRowPx()}px`,
                }}
            >
                <text style={{ fontSize: props.size ?? 32 }} text={props.glyph} />
            </list-item>
        );
});
