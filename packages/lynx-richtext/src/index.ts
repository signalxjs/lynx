import './jsx-augment.js';

export { RichTextInput } from './RichTextInput.js';
export type { RichTextInputProps } from './RichTextInput.js';

export { RichTextMethods } from './methods.js';
export type { RichTextHandle } from './methods.js';

export { encodeDoc, decodeDoc, docEquals, normalizeDoc, emptyDoc } from './model/codec.js';

export type {
    RichDoc,
    InlineSpan,
    InlineSpanType,
    BlockAttr,
    BlockAttrType,
    SelectionState,
    RichTextChangeEvent,
    RichTextSelectionEvent,
    RichTextHeightChangeEvent,
    RichTextFocusEvent,
} from './model/types.js';

export type { SigxRichTextAttributes } from './jsx-augment.js';
