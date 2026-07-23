import { component, useFontScale, type Define } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import type { EmojiDatum, SkinTone } from '../data/schema.js';
import { glyphForTone } from '../data/glyph.js';

export type SkinTonePopoverProps =
    /** The long-pressed emoji (must have `s` variants). */
    & Define.Prop<'datum', EmojiDatum, true>
    /** Localized tone labels from the dataset (`data.skinTones`), index `tone - 1`. */
    & Define.Prop<'toneLabels', string[], true>
    /** Currently sticky tone (highlighted). */
    & Define.Prop<'activeTone', SkinTone, false>
    /** Variant glyph font size — the picker passes its resolved cell size. Default 32. */
    & Define.Prop<'size', number, false>
    & Define.Prop<'backdropClass', string, false>
    & Define.Prop<'class', string, false>
    & Define.Prop<'cellClass', string, false>
    & Define.Event<'select', SkinTone>
    & Define.Event<'close', void>;

const BORDER = 'rgba(127, 127, 127, 0.32)';
/** Same neutral surface rationale as lynx-markdown's SuggestionPopup. */
const SURFACE = '#f4f4f5';
const ACTIVE_BG = 'rgba(128,128,128,0.25)';
const TONES: SkinTone[] = [0, 1, 2, 3, 4, 5];

/**
 * The skin-tone chooser — a centered overlay row of the base glyph plus its
 * five uniform variants, shown on cell long-press. Selecting one is both an
 * insert *and* the sticky preference (the WhatsApp model). Backdrop tap
 * dismisses.
 *
 * Rendered by the picker over its own root (`position: absolute` within the
 * picker), so it needs no page-level portal or caret math.
 */
export const SkinTonePopover = component<SkinTonePopoverProps>(({ props, emit }) => {
    // Pinned like the grid — the popover's fixed geometry assumes `size` (#776).
    const fontScale = useFontScale();
    return () => (
        <view
            class={props.backdropClass}
            bindtap={() => emit('close')}
            style={{
                position: 'absolute',
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
                zIndex: 30,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            {/* catchtap, not a bindtap stopPropagation no-op — the runtime
                has no e.stopPropagation(); see SheetPicker (#254). */}
            <view
                catchtap={() => {}}
                class={props.class}
                style={props.class ? { display: 'flex', flexDirection: 'row' } : {
                    display: 'flex',
                    flexDirection: 'row',
                    borderRadius: '12px',
                    borderWidth: '1px',
                    borderColor: BORDER,
                    backgroundColor: SURFACE,
                    paddingLeft: '6px',
                    paddingRight: '6px',
                    paddingTop: '4px',
                    paddingBottom: '4px',
                }}
            >
                {TONES.map((tone) => {
                    const active = tone === (props.activeTone ?? 0);
                    return (
                        <Pressable
                            key={String(tone)}
                            class={props.cellClass}
                            style={{
                                paddingLeft: '8px',
                                paddingRight: '8px',
                                paddingTop: '6px',
                                paddingBottom: '6px',
                                borderRadius: '8px',
                                ...(active ? { backgroundColor: ACTIVE_BG } : {}),
                            }}
                            accessibility-element={true}
                            accessibility-label={tone === 0 ? props.datum.n : `${props.datum.n}: ${props.toneLabels[tone - 1]}`}
                            accessibility-trait="button"
                            accessibility-status={active ? 'selected' : undefined}
                            onPress={() => emit('select', tone)}
                        >
                            <text style={{ fontSize: (props.size ?? 32) / fontScale.value }}>{glyphForTone(props.datum, tone)}</text>
                        </Pressable>
                    );
                })}
            </view>
        </view>
    );
});
