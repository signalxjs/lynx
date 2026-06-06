/**
 * daisyUI-themed bottom-sheet emoji picker — `@sigx/lynx-emoji`'s
 * `SheetPicker` skinned with {@link emojiClasses} and a base-100 sheet
 * surface. Same two-layer deal as `EditorToolbar` vs `daisyToolbarItem`:
 * use this for the one-liner, or take `emojiClasses` and compose the
 * headless parts yourself.
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
    SheetPicker,
    type EmojiData,
    type EmojiPickEvent,
    type EmojiSlotClasses,
} from '@sigx/lynx-emoji';
import { emojiClasses } from './components.js';

export type EmojiPickerSheetProps =
    & Define.Prop<'open', boolean, true>
    & Define.Prop<'onClose', () => void, false>
    /** Locale dataset; optional under an `<EmojiProvider>`. */
    & Define.Prop<'data', EmojiData, false>
    & Define.Prop<'height', number, false>
    & Define.Prop<'columns', number, false>
    /** Merge/override individual slot classes on top of the daisy skin. */
    & Define.Prop<'classes', EmojiSlotClasses, false>
    & Define.Event<'pick', EmojiPickEvent>;

export const EmojiPickerSheet = component<EmojiPickerSheetProps>(({ props, emit }) => {
    return () => (
        <SheetPicker
            open={props.open}
            onClose={props.onClose}
            data={props.data}
            height={props.height}
            columns={props.columns}
            sheetClass="bg-base-100 rounded-t-2xl border-t border-base-300"
            classes={{ ...emojiClasses, ...props.classes }}
            onPick={(e) => emit('pick', e)}
        />
    );
});
