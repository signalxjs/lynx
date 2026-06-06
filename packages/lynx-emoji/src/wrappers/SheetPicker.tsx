import { component, type Define } from '@sigx/lynx';
import type { EmojiPickEvent } from '../types.js';
import { EmojiPicker, type EmojiPickerProps } from '../components/EmojiPicker.js';

export type SheetPickerProps =
    & Omit<EmojiPickerProps, 'style' | 'onPick'>
    & Define.Prop<'open', boolean, true>
    & Define.Prop<'onClose', () => void, false>
    /** Sheet height in px. Default 420. */
    & Define.Prop<'height', number, false>
    /** Extra classes for the sheet surface (a theme's card/rounded classes). */
    & Define.Prop<'sheetClass', string, false>
    & Define.Event<'pick', EmojiPickEvent>;

const BACKDROP = 'rgba(0, 0, 0, 0.35)';
const SURFACE = '#f4f4f5';

/**
 * The overlay presentation: a bottom sheet over a dimmed backdrop (the
 * reaction-picker / one-off use case — for a chat composer prefer
 * `KeyboardPanelPicker`). Same overlay idiom as daisyui's Modal: backdrop
 * tap closes, sheet taps don't propagate. Mount it near the screen root so
 * `position: absolute` covers the screen.
 */
export const SheetPicker = component<SheetPickerProps>(({ props, emit }) => {
    return () => {
        if (!props.open) return <view style={{ display: 'none' }} />;
        return (
            <view
                bindtap={() => props.onClose?.()}
                style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: 40,
                    backgroundColor: BACKDROP,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-end',
                }}
            >
                <view
                    bindtap={(e: { stopPropagation?: () => void }) => e?.stopPropagation?.()}
                    class={props.sheetClass}
                    style={{
                        height: `${props.height ?? 420}px`,
                        display: 'flex',
                        flexDirection: 'column',
                        ...(props.sheetClass ? {} : {
                            backgroundColor: SURFACE,
                            borderTopLeftRadius: '16px',
                            borderTopRightRadius: '16px',
                        }),
                    }}
                >
                    <EmojiPicker
                        data={props.data}
                        columns={props.columns}
                        showRecents={props.showRecents}
                        showSearch={props.showSearch}
                        searchPlaceholder={props.searchPlaceholder}
                        cellSize={props.cellSize}
                        classes={props.classes}
                        class={props.class}
                        renderCell={props.renderCell}
                        renderCategoryTab={props.renderCategoryTab}
                        renderSearchInput={props.renderSearchInput}
                        onPick={(e) => emit('pick', e)}
                    />
                </view>
            </view>
        );
    };
});
