import { component, type Define } from '@sigx/lynx';
import type { EmojiDatum } from '../data/schema.js';
import type { EmojiRenderCell } from '../types.js';

export type EmojiCellProps =
    & Define.Prop<'datum', EmojiDatum, true>
    /** Tone-resolved glyph to render (the caller applies the sticky tone). */
    & Define.Prop<'glyph', string, true>
    /** Glyph font size. Default 26. */
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
    // 6+6px padding + the glyph at ~1.2 line-height (the row estimate native
    // uses to size the scroll range before cells build).
    const estRowPx = (): number => Math.round((props.size ?? 26) * 1.2) + 12;

    return () => props.render
        ? (
            // Render-prop branch: a SEPARATE template whose content is a slot —
            // functional but non-poolable (see the prop's TSDoc). Kept apart
            // from the default shape so default cells stay slot-free.
            <list-item
                item-key={props.datum.e}
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
                    paddingTop: '6px',
                    paddingBottom: '6px',
                }}
            >
                {props.render(props.datum, props.glyph)}
            </list-item>
        )
        : (
            <list-item
                item-key={props.datum.e}
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
                    paddingTop: '6px',
                    paddingBottom: '6px',
                }}
            >
                <text style={{ fontSize: props.size ?? 26 }} text={props.glyph} />
            </list-item>
        );
});
