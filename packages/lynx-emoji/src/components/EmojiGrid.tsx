import { component, useElementLayout, type Define } from '@sigx/lynx';
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
 * Layout: `class`/`style` land on a measuring wrapper `<view>`, so flex
 * sizing works as usual (`style={{ flexGrow: 1 }}` in a column — avoid the
 * inline `flex` shorthand; iOS Lynx 3.8 doesn't expand it). The native
 * `<list>` itself only lays out with a *concrete* height (flex/percent
 * resolve to zero → nothing renders — verified on iOS Lynx 3.8), so the
 * wrapper measures itself via `bindlayoutchange` and pins the list to the
 * measured px height. The list must stay mounted from the first render
 * (1px placeholder until the measure lands) — `bindlayoutchange` does not
 * fire on a childless view, so conditionally mounting on the measured
 * height deadlocks at 0. First paint happens one frame after mount.
 */
export const EmojiGrid = component<EmojiGridProps>(({ props, emit }) => {
    const { layout, onLayoutChange } = useElementLayout();

    return () => {
        const height = layout.value?.height ?? 0;
        return (
            <view
                class={props.class}
                style={props.style}
                bindlayoutchange={onLayoutChange}
            >
                <list
                    span-count={props.columns ?? 8}
                    list-type="flow"
                    scroll-orientation="vertical"
                    style={{ height: height > 0 ? `${height}px` : '1px' }}
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
            </view>
        );
    };
});
