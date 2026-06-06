import { component, type Define } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import type { EmojiDatum } from '../data/schema.js';
import type { EmojiRenderCell } from '../types.js';

export type EmojiCellProps =
    & Define.Prop<'datum', EmojiDatum, true>
    /** Tone-resolved glyph to render (the caller applies the sticky tone). */
    & Define.Prop<'glyph', string, true>
    /** Glyph font size. Default 26. */
    & Define.Prop<'size', number, false>
    & Define.Prop<'class', string, false>
    & Define.Prop<'render', EmojiRenderCell, false>
    & Define.Event<'pick', EmojiDatum>
    /** Long-press on a tonal emoji (only emitted when variants exist). */
    & Define.Event<'pickTone', EmojiDatum>;

/**
 * One grid cell — a Pressable glyph. Tap picks; long-press asks for the
 * skin-tone popover when the emoji has uniform tone variants.
 */
export const EmojiCell = component<EmojiCellProps>(({ props, emit }) => {
    return () => (
        <Pressable
            class={props.class}
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                paddingTop: '6px',
                paddingBottom: '6px',
            }}
            accessibility-element={true}
            accessibility-label={props.datum.n}
            accessibility-trait="button"
            onPress={() => emit('pick', props.datum)}
            onLongPress={() => {
                if (props.datum.s) emit('pickTone', props.datum);
            }}
        >
            {props.render
                ? props.render(props.datum, props.glyph)
                : <text style={{ fontSize: props.size ?? 26 }}>{props.glyph}</text>}
        </Pressable>
    );
});
