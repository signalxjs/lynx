import { component, signal, watch, type Define } from '@sigx/lynx';
import { useKeyboard } from '@sigx/lynx-keyboard';
import type { EmojiPickEvent } from '../types.js';
import { EmojiPicker, type EmojiPickerProps } from '../components/EmojiPicker.js';

export type KeyboardPanelPickerProps =
    & Omit<EmojiPickerProps, 'style' | 'onPick'>
    /** Whether the panel is shown (toggle from your composer's emoji button). */
    & Define.Prop<'open', boolean, true>
    /** Fallback panel height before the keyboard has ever opened. Default 300. */
    & Define.Prop<'fallbackHeight', number, false>
    & Define.Event<'pick', EmojiPickEvent>;

/**
 * The chat-composer presentation: a panel that occupies exactly the soft
 * keyboard's space, so toggling emoji ⇄ keyboard doesn't shift the composer
 * (the WhatsApp/Telegram pattern). Place it as the last child of a
 * `<KeyboardStickyView>`, under the input row; the keyboard height comes
 * from `useKeyboard()` (needs a `<SafeAreaProvider>` ancestor) and the
 * largest height seen is remembered so the panel keeps the right size after
 * the keyboard dismisses.
 *
 * ```tsx
 * <KeyboardStickyView>
 *   <Composer onEmojiButton={() => toggle()} />
 *   <KeyboardPanelPicker open={open.value} data={data} onPick={insert} />
 * </KeyboardStickyView>
 * ```
 */
export const KeyboardPanelPicker = component<KeyboardPanelPickerProps>(({ props, emit }) => {
    const keyboard = useKeyboard();
    const panelHeight = signal(0);
    watch(() => keyboard.value.height, (h) => {
        if (h > panelHeight.value) panelHeight.value = h;
    });

    return () => {
        if (!props.open) return <view style={{ display: 'none' }} />;
        const height = panelHeight.value > 0 ? panelHeight.value : (props.fallbackHeight ?? 300);
        return (
            <view style={{ height: `${height}px`, display: 'flex', flexDirection: 'column' }}>
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
        );
    };
});
