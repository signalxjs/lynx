/**
 * JSX intrinsic type augmentation for the native `<sigx-richtext>` element.
 *
 * Registered natively via the autolinker (`signalx-module.json` →
 * `ios.uiComponents` / `android.behaviors`). Importing this module (pulled in
 * by the package entry point) declares the tag and its typed attribute/event
 * surface.
 */

import type { LynxCommonAttributes, LynxEventHandler } from '@sigx/lynx-runtime';
import type {
    RichTextChangeEvent,
    RichTextFocusEvent,
    RichTextHeightChangeEvent,
    RichTextSelectionEvent,
} from './model/types.js';

export interface SigxRichTextAttributes extends LynxCommonAttributes {
    /**
     * Initial document as a JSON-encoded `RichDoc` (`encodeDoc`). Initial-only
     * once the user has edited — programmatic replacements must go through the
     * `setDocument` UI method (see `RichTextMethods`).
     */
    value?: string;
    placeholder?: string;
    editable?: boolean;
    /** Auto-grow floor, px. */
    'min-height'?: number;
    /** Auto-grow ceiling, px — content beyond this scrolls internally. */
    'max-height'?: number;
    /** Base font size, px (headings scale from this). */
    'editor-font-size'?: number;
    /** Base text color (hex). */
    'text-color'?: string;
    /** Caret tint + link color (hex). */
    'accent-color'?: string;
    /** Placeholder text color (hex). */
    'placeholder-color'?: string;
    /** Native confirm/return key type. */
    'confirm-type'?: 'send' | 'search' | 'next' | 'go' | 'done';
    /** Focus + raise the keyboard on mount. */
    'auto-focus'?: boolean;

    bindchange?: LynxEventHandler<RichTextChangeEvent>;
    bindselection?: LynxEventHandler<RichTextSelectionEvent>;
    bindheightchange?: LynxEventHandler<RichTextHeightChangeEvent>;
    bindfocus?: LynxEventHandler<RichTextFocusEvent>;
    bindblur?: LynxEventHandler<RichTextFocusEvent>;
}

declare global {
    namespace JSX {
        interface IntrinsicElements {
            'sigx-richtext': SigxRichTextAttributes;
        }
    }
}
