/**
 * `<RichTextInput>` — typed SignalX wrapper over the native `<sigx-richtext>`
 * element.
 *
 * This is the *generic* attributed-text input: it knows nothing about
 * markdown. `@sigx/lynx-markdown`'s `MarkdownEditor` builds the markdown
 * mapping, toolbar, and plugin system on top of it.
 *
 * Events are decoded into typed shapes (`RichDoc`, `SelectionState`) before
 * reaching handlers; commands go through {@link RichTextMethods} with the
 * element handle delivered via `onElement`.
 */

import { component, type Define } from '@sigx/lynx';
import './jsx-augment.js';
import { decodeDoc } from './model/codec.js';
import type {
    BlockAttrType,
    InlineSpanType,
    RichDoc,
    RichTextChangeEvent,
    RichTextHeightChangeEvent,
    RichTextSelectionEvent,
    SelectionState,
} from './model/types.js';
import type { RichTextHandle } from './methods.js';

export type RichTextInputProps =
    & Define.Prop<'value', RichDoc | string, false>
    & Define.Prop<'placeholder', string, false>
    & Define.Prop<'editable', boolean, false>
    & Define.Prop<'minHeight', number, false>
    & Define.Prop<'maxHeight', number, false>
    & Define.Prop<'fontSize', number, false>
    & Define.Prop<'textColor', string, false>
    & Define.Prop<'accentColor', string, false>
    & Define.Prop<'placeholderColor', string, false>
    & Define.Prop<'confirmType', 'send' | 'search' | 'next' | 'go' | 'done', false>
    & Define.Prop<'autoFocus', boolean, false>
    & Define.Prop<'class', string, false>
    & Define.Prop<'style', string | Record<string, string | number>, false>
    /** Receives the BG element handle for {@link RichTextMethods} commands. */
    & Define.Prop<'onElement', (el: RichTextHandle) => void, false>
    & Define.Prop<'onChange', (doc: RichDoc, isComposing: boolean) => void, false>
    & Define.Prop<'onSelection', (sel: SelectionState) => void, false>
    & Define.Prop<'onHeightChange', (height: number, lines: number) => void, false>
    & Define.Prop<'onFocus', () => void, false>
    & Define.Prop<'onBlur', () => void, false>;

export const RichTextInput = component<RichTextInputProps>(({ props }) => {
    const handleChange = (e: RichTextChangeEvent): void => {
        props.onChange?.(decodeDoc(e.detail.doc), !!e.detail.isComposing);
    };

    const handleSelection = (e: RichTextSelectionEvent): void => {
        const d = e.detail;
        props.onSelection?.({
            start: d.start,
            end: d.end,
            activeFormats: parseFormats(d.activeFormats),
            activeBlock: (d.activeBlock || 'paragraph') as BlockAttrType,
            ...(d.headingLevel !== undefined ? { headingLevel: d.headingLevel } : {}),
            caretRect: { x: d.caretX ?? 0, y: d.caretY ?? 0, height: d.caretHeight ?? 0 },
        });
    };

    const handleHeight = (e: RichTextHeightChangeEvent): void => {
        props.onHeightChange?.(e.detail.height, e.detail.lines);
    };

    return () => (
        <sigx-richtext
            ref={(el: RichTextHandle) => props.onElement?.(el)}
            value={typeof props.value === 'string' ? props.value : props.value ? JSON.stringify(props.value) : undefined}
            placeholder={props.placeholder}
            editable={props.editable}
            min-height={props.minHeight}
            max-height={props.maxHeight}
            editor-font-size={props.fontSize}
            text-color={props.textColor}
            accent-color={props.accentColor}
            placeholder-color={props.placeholderColor}
            confirm-type={props.confirmType}
            auto-focus={props.autoFocus}
            class={props.class}
            style={props.style}
            bindchange={handleChange}
            bindselection={handleSelection}
            bindheightchange={handleHeight}
            bindfocus={() => props.onFocus?.()}
            bindblur={() => props.onBlur?.()}
        />
    );
});

function parseFormats(raw: string | undefined): InlineSpanType[] {
    if (!raw) return [];
    return raw.split(',').filter(Boolean) as InlineSpanType[];
}
