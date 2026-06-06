import { component, type Define } from '@sigx/lynx';
import type { EmojiDatum, SkinTone } from '../data/schema.js';
import { glyphForTone } from '../data/glyph.js';
import type { EmojiRenderCell } from '../types.js';
import { EmojiCell } from './EmojiCell.js';

export type EmojiGridProps =
    /** The emoji to show (one category, search hits, recents…). */
    & Define.Prop<'emojis', EmojiDatum[], true>
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
 * The headless grid — a native `<list>` recycler in flow layout, so only
 * on-screen cells exist as views regardless of how many emoji are passed
 * (`item-type="emoji"` puts every cell in one shared recycle pool).
 *
 * Layout note: `<list>` sizes from its container — give the grid a bounded
 * height (`flex: 1` inside the picker column, or an explicit height).
 */
export const EmojiGrid = component<EmojiGridProps>(({ props, emit }) => {
    return () => (
        <list
            class={props.class}
            span-count={props.columns ?? 8}
            list-type="flow"
            scroll-orientation="vertical"
            style={props.style}
        >
            {props.emojis.map((datum) => (
                <list-item item-key={datum.e} item-type="emoji" key={datum.e}>
                    <EmojiCell
                        datum={datum}
                        glyph={glyphForTone(datum, props.tone ?? 0)}
                        size={props.cellSize}
                        class={props.cellClass}
                        render={props.renderCell}
                        onPick={(d) => emit('pick', d)}
                        onPickTone={(d) => emit('pickTone', d)}
                    />
                </list-item>
            ))}
        </list>
    );
});
