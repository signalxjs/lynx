/**
 * daisyUI-themed bottom-sheet emoji picker — `@sigx/lynx-emoji`'s
 * `EmojiPicker` inside `@sigx/lynx-sheet`'s `<BottomSheet>` (dismissible +
 * backdrop), skinned with {@link emojiClasses} and a base-100 surface.
 * Successor to the hand-rolled overlay it used to wrap (#774): backdrop
 * tap and drag-down both dismiss, the dim tracks the drag, and the grabber
 * strip drags while the grid keeps scrolling.
 *
 * Mount it as the LAST child of a full-surface positioned container (the
 * screen root) — Lynx stacks by document order, so that is what lets the
 * backdrop dim the whole screen.
 *
 * ```tsx
 * <EmojiPickerSheet
 *     open={open.value}
 *     data={enData}
 *     onPick={({ glyph }) => insert(glyph)}
 *     onClose={() => { open.value = false; }}
 * />
 * ```
 */

import { component, type Define } from '@sigx/lynx';
import {
    EmojiPicker,
    type EmojiData,
    type EmojiPickEvent,
    type EmojiSlotClasses,
} from '@sigx/lynx-emoji';
import { BottomSheet } from '@sigx/lynx-sheet';
import { emojiClasses } from './components.js';

export type EmojiPickerSheetProps =
    & Define.Prop<'open', boolean, true>
    /** Called when the sheet dismisses (backdrop tap or drag-down). */
    & Define.Prop<'onClose', () => void, false>
    /** Locale dataset; optional under an `<EmojiProvider>`. */
    & Define.Prop<'data', EmojiData, false>
    /** Sheet height in px. Default 420. */
    & Define.Prop<'height', number, false>
    & Define.Prop<'columns', number, false>
    /** Merge/override individual slot classes on top of the daisy skin. */
    & Define.Prop<'classes', EmojiSlotClasses, false>
    & Define.Event<'pick', EmojiPickEvent>;

export const EmojiPickerSheet = component<EmojiPickerSheetProps>(({ props, emit }) => {
    return () => (
        <BottomSheet
            detents={[props.height ?? 420]}
            open={props.open}
            dismissible
            backdrop
            // The grid is a virtualized list (no ScrollDragHost adoption
            // yet), so only the grabber strip drags — grid scroll stays
            // native. Drag-down on the strip or a backdrop tap dismisses.
            dragMode="grabber"
            class="bg-base-100 rounded-t-2xl border-t border-base-300"
            onDismiss={() => props.onClose?.()}
            slots={{
                // Visible grabber affordance sitting inside the grabber
                // chrome zone — it also pushes the picker's search row
                // below the drag strip so the two never compete.
                handle: () => (
                    <view
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            paddingTop: '8px',
                            paddingBottom: '6px',
                        }}
                    >
                        <view class="w-10 h-1 rounded-full bg-base-300" />
                    </view>
                ),
                default: () => (
                    // Mounted only while open — matches the previous
                    // overlay's cold-mount behavior so screens that never
                    // open the picker never pay for the grid.
                    props.open
                        ? (
                            <EmojiPicker
                                data={props.data}
                                columns={props.columns}
                                classes={{ ...emojiClasses, ...props.classes }}
                                onPick={(e) => emit('pick', e)}
                            />
                        )
                        : null
                ),
            }}
        />
    );
});
