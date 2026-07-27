import { component, useFontScale, type Define, type JSXElement } from '@sigx/lynx';
import type { EmojiDatum, SkinTone } from '../data/schema.js';
import { glyphForTone } from '../data/glyph.js';
import { useEmojiContext } from '../state/context.js';
import { emojiRowPx } from '../metrics.js';
import type { EmojiPickEvent, EmojiRenderCell } from '../types.js';

export type EmojiStripProps =
    /** What to show, in order. Usually search hits or recents. */
    & Define.Prop<'emojis', readonly EmojiDatum[], true>
    /**
     * Max cells rendered. Default 48 — a strip is a peek at the top hits,
     * not a catalog, and every cell here is a real element (no windowing).
     * Hand a longer list a `<EmojiGrid>` instead.
     */
    & Define.Prop<'limit', number, false>
    /**
     * Skin tone for tonal glyphs. Defaults to the shared context's sticky
     * tone when an `<EmojiProvider>` is in scope, else 0 (base).
     */
    & Define.Prop<'tone', SkinTone, false>
    /** Glyph font size. Default 32. */
    & Define.Prop<'cellSize', number, false>
    /** Shown instead of the row when `emojis` is empty. */
    & Define.Prop<'emptyLabel', string, false>
    & Define.Prop<'class', string, false>
    & Define.Prop<'cellClass', string, false>
    & Define.Prop<'emptyClass', string, false>
    & Define.Prop<'renderCell', EmojiRenderCell, false>
    & Define.Prop<'style', Record<string, string | number>, false>
    & Define.Event<'pick', EmojiPickEvent>;

/**
 * A ONE-ROW horizontal emoji strip — the shape WhatsApp shows above the
 * keyboard while you search, and the same shape a reaction bar wants.
 *
 * Deliberately not a `<EmojiGrid>`: the grid is a virtualized `<list>` whose
 * cells are `<list-item>` templates (only valid inside a list) and whose
 * mount cost is tuned for ~1,900 rows. A strip is a handful of cells in a
 * `<scroll-view>`, so it can mount and re-mount per keystroke without the
 * grid's staging machinery.
 *
 * Picks push to the shared recents when an `<EmojiProvider>` is in scope,
 * exactly like the picker's — so a strip and a picker stay in sync.
 */
export const EmojiStrip = component<EmojiStripProps>(({ props, emit }) => {
    // Pinned like the picker's chrome (#776): the row's fixed height assumes
    // `cellSize` glyphs, so the glyph counter-divides the OS font scale.
    const fontScale = useFontScale();
    const ctx = useEmojiContext();

    const toneOf = (): SkinTone => props.tone ?? ctx?.skinTone.state.tone ?? 0;

    const pick = (datum: EmojiDatum): void => {
        const tone = toneOf();
        ctx?.recents.push(datum);
        emit('pick', { datum, glyph: glyphForTone(datum, tone), tone });
    };

    return () => {
        const size = props.cellSize ?? 32;
        const rowPx = emojiRowPx(size);
        const tone = toneOf();
        const shown = props.emojis.slice(0, props.limit ?? 48);

        if (shown.length === 0) {
            return (
                <view
                    class={props.emptyClass}
                    style={{
                        height: `${rowPx}px`,
                        display: 'flex',
                        alignItems: 'center',
                        paddingLeft: '12px',
                        ...(props.emptyClass ? {} : { opacity: 0.55 }),
                        ...props.style,
                    }}
                >
                    <text style={{ fontSize: 14 / fontScale.value }}>{props.emptyLabel ?? 'No emoji found'}</text>
                </view>
            );
        }

        return (
            <scroll-view
                scroll-orientation="horizontal"
                class={props.class}
                style={{ height: `${rowPx}px`, ...props.style }}
            >
                <view style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
                    {shown.map((datum) => {
                        const glyph = glyphForTone(datum, tone);
                        return (
                            <view
                                key={datum.e}
                                class={props.cellClass}
                                accessibility-element={true}
                                accessibility-label={datum.n}
                                accessibility-trait="button"
                                bindtap={() => pick(datum)}
                                style={{
                                    width: `${rowPx}px`,
                                    height: `${rowPx}px`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                            >
                                {props.renderCell
                                    ? props.renderCell(datum, glyph)
                                    : <text style={{ fontSize: size / fontScale.value }} text={glyph} />}
                            </view>
                        ) as JSXElement;
                    })}
                </view>
            </scroll-view>
        );
    };
});
