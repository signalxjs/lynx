import { component, type Define, type JSXElement } from '@sigx/lynx';
import type { EmojiDatum } from '../data/schema.js';
import type { EmojiRenderCell } from '../types.js';

/**
 * Row height (px) a cell of `size` occupies: the glyph's visible INK
 * (emoji fonts ink ~64% of the em) plus 9px of air — row spacing tracks
 * what the eye sees, not the font metric (WhatsApp-dense), PINNED as the cell's explicit height. This is
 * simultaneously the cell's `estimated-main-axis-size-px` and the exact
 * per-row height the sectioned grid's scroll-offset math uses — est == actual
 * by construction (padding-derived heights drifted; #663 device gate).
 */
export const emojiRowPx = (size?: number): number => Math.round((size ?? 32) * 0.64) + 9;

/** Everything the default (glyph) cell row needs — see {@link emojiCellRow}. */
export interface EmojiCellRowArgs {
    datum: EmojiDatum;
    /** Tone-resolved glyph to render (the caller applies the sticky tone). */
    glyph: string;
    /** Unique `item-key` (sectioned grids prefix with the section key). */
    itemKey: string;
    /** Glyph font size. Default 32. */
    size?: number;
    class?: string;
    onPick: (datum: EmojiDatum) => void;
    onPickTone: (datum: EmojiDatum) => void;
}

/**
 * The default glyph cell as a PLAIN template row — no component instance.
 *
 * A `component()` wrapper costs a runtime-core instance (proxies, effect,
 * lifecycle) PER ROW; at ~1,900 rows that dominated the sectioned picker's
 * mount (#666: ~1.6s of reconcile on a release build). This function returns
 * the `<list-item>` template vnode directly — the reconciler keys it by
 * `item-key`, snapshot event signs stay stable per instance, and mount cost
 * collapses to vnode + hole normalization.
 *
 * The template compiles to a ZERO-SLOT shape (the glyph is a `text`
 * ATTRIBUTE hole, not a child), so cells pool/recycle. `item-key` is
 * tone-free, so a sticky-tone change re-patches glyph holes in place.
 */
export function emojiCellRow(args: EmojiCellRowArgs): JSXElement {
    const { datum, onPick, onPickTone } = args;
    const rowPx = emojiRowPx(args.size);
    return (
        <list-item
            item-key={args.itemKey}
            item-type="emoji"
            estimated-main-axis-size-px={rowPx}
            class={args.class}
            accessibility-element={true}
            accessibility-label={datum.n}
            accessibility-trait="button"
            bindtap={() => onPick(datum)}
            bindlongpress={() => { if (datum.s) onPickTone(datum); }}
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: `${rowPx}px`,
            }}
        >
            <text style={{ fontSize: args.size ?? 32 }} text={args.glyph} />
        </list-item>
    );
}

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
 * Component wrapper around {@link emojiCellRow} (the grid calls that plain
 * function directly for its ~1,900 default rows — see its TSDoc); this
 * component exists for external composition and for the `render`-prop
 * branch, whose content is a slot (non-poolable, dedicated tree per cell).
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
                    // Height PINNED to the estimate — the native size estimate
                    // and the sectioned grid's scroll-offset math both assume
                    // emojiRowPx exactly (#663 device gate).
                    height: `${estRowPx()}px`,
                }}
            >
                {props.render(props.datum, props.glyph)}
            </list-item>
        )
        : emojiCellRow({
            datum: props.datum,
            glyph: props.glyph,
            itemKey: props.itemKey ?? props.datum.e,
            size: props.size,
            class: props.class,
            onPick: (d) => emit('pick', d),
            onPickTone: (d) => emit('pickTone', d),
        });
});
