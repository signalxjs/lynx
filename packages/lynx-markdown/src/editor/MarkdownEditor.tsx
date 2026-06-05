/**
 * `<MarkdownEditor>` — true-WYSIWYG markdown editing on the native
 * `<sigx-richtext>` element.
 *
 * The external contract is **markdown**: `value` in, `onChange(markdown)` out.
 * Internally the editor converts markdown ↔ the element's `RichDoc` span model
 * (`convert/mdToDoc`, `convert/docToMd`) and drives formatting through
 * fire-and-forget commands; the element is the single source of truth for live
 * text and selection (lightly-controlled — keystrokes are never echoed back).
 *
 * ### Echo / IME rules (JS side)
 * - An incoming `value` identical to the last markdown we emitted is our own
 *   echo → ignored (string compare; exact).
 * - Otherwise it's compared structurally against the element's last document —
 *   only genuinely different content is pushed via `setDocument`.
 * - While the IME is composing, external values are buffered and applied on
 *   the composition-end change; `onChange` is also suppressed mid-composition.
 *
 * Sizing: `minLines`/`maxLines` × line height drive the element's auto-grow
 * window (`mode="auto"`, chat-style 1 → N lines then internal scroll);
 * `mode="fixed"` pins the height at `maxLines`; `mode="fullscreen"` fills the
 * parent.
 */

import { component, signal, watch, type Define } from '@sigx/lynx';
import {
    RichTextInput,
    RichTextMethods,
    docEquals,
    normalizeDoc,
    emptyDoc,
    type RichDoc,
    type RichTextHandle,
    type SelectionState,
} from '@sigx/lynx-richtext';
import { mdToDoc } from './convert/mdToDoc.js';
import { docToMd } from './convert/docToMd.js';

export type MarkdownEditorMode = 'auto' | 'fixed' | 'fullscreen';

/** Imperative command surface — what toolbars and plugins drive. */
export interface MarkdownEditorController {
    toggleBold(): void;
    toggleItalic(): void;
    toggleStrike(): void;
    toggleCode(): void;
    /** 1–6 sets a heading; 0 reverts to paragraph. */
    setHeading(level: 0 | 1 | 2 | 3 | 4 | 5 | 6): void;
    insertText(text: string): void;
    /** Clear the document (chat send). */
    clear(): void;
    focus(): void;
    blur(): void;
    /** The current markdown (as of the last element change). */
    getMarkdown(): string;
    /** The current selection state (as of the last selection event). */
    getSelection(): SelectionState | null;
}

export type MarkdownEditorProps =
    & Define.Prop<'value', string, false>
    & Define.Prop<'placeholder', string, false>
    & Define.Prop<'minLines', number, false>
    & Define.Prop<'maxLines', number, false>
    & Define.Prop<'mode', MarkdownEditorMode, false>
    & Define.Prop<'fontSize', number, false>
    & Define.Prop<'textColor', string, false>
    & Define.Prop<'accentColor', string, false>
    & Define.Prop<'placeholderColor', string, false>
    & Define.Prop<'confirmType', 'send' | 'search' | 'next' | 'go' | 'done', false>
    & Define.Prop<'autoFocus', boolean, false>
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'class', string, false>
    & Define.Prop<'onChange', (markdown: string) => void, false>
    & Define.Prop<'onSelectionChange', (sel: SelectionState) => void, false>
    & Define.Prop<'onFocus', () => void, false>
    & Define.Prop<'onBlur', () => void, false>
    /** Receives the imperative controller once on mount. */
    & Define.Prop<'controllerRef', (ctrl: MarkdownEditorController) => void, false>;

const DEFAULT_FONT_SIZE = 16;
/** Vertical padding the element applies internally (8 top + 8 bottom). */
const ELEMENT_PADDING = 16;

export const MarkdownEditor = component<MarkdownEditorProps>(({ props }) => {
    let el: RichTextHandle = null;

    // --- sync state (see module docs) ---
    const initialMd = typeof props.value === 'string' ? props.value : '';
    let lastEmittedMd: string | null = initialMd;
    let lastDocFromElement: RichDoc = normalizeDoc(mdToDoc(initialMd));
    let lastSeenVersion = 0;
    let composing = false;
    let pendingExternal: string | null = null;
    let currentSel: SelectionState | null = null;

    // Auto-grow: the native element reports its (clamped) content height and
    // the editor feeds it back as the element's layout height — Lynx layout
    // sizes views from styles, never from native intrinsic content.
    const reportedHeight = signal(0);

    const applyExternal = (md: string): void => {
        if (md === lastEmittedMd) return; // our own echo
        if (composing) {
            pendingExternal = md;
            return;
        }
        const doc = mdToDoc(md, lastSeenVersion);
        if (docEquals(normalizeDoc(doc), lastDocFromElement)) {
            lastEmittedMd = md; // same content, different markdown spelling
            return;
        }
        RichTextMethods.setDocument(el, doc);
    };

    watch(
        () => props.value,
        (next) => {
            if (typeof next === 'string') applyExternal(next);
        },
    );

    const handleChange = (doc: RichDoc, isComposing: boolean): void => {
        composing = isComposing;
        lastSeenVersion = doc.v;
        lastDocFromElement = normalizeDoc(doc);
        if (isComposing) return;
        const md = docToMd(doc);
        if (md !== lastEmittedMd) {
            lastEmittedMd = md;
            props.onChange?.(md);
        }
        if (pendingExternal !== null) {
            const pending = pendingExternal;
            pendingExternal = null;
            applyExternal(pending);
        }
    };

    const controller: MarkdownEditorController = {
        toggleBold: () => RichTextMethods.toggleFormat(el, 'bold'),
        toggleItalic: () => RichTextMethods.toggleFormat(el, 'italic'),
        toggleStrike: () => RichTextMethods.toggleFormat(el, 'strike'),
        toggleCode: () => RichTextMethods.toggleFormat(el, 'code'),
        setHeading: (level) => {
            if (level === 0) RichTextMethods.setBlockType(el, 'paragraph');
            else RichTextMethods.setBlockType(el, 'heading', level);
        },
        insertText: (text) => RichTextMethods.insertText(el, text),
        clear: () => RichTextMethods.setDocument(el, emptyDoc(lastSeenVersion)),
        focus: () => RichTextMethods.focus(el),
        blur: () => RichTextMethods.blur(el),
        getMarkdown: () => lastEmittedMd ?? '',
        getSelection: () => currentSel,
    };
    props.controllerRef?.(controller);

    return () => {
        const fontSize = props.fontSize ?? DEFAULT_FONT_SIZE;
        const lineHeight = Math.round(fontSize * 1.5);
        const mode = props.mode ?? 'auto';
        const minLines = Math.max(1, props.minLines ?? 1);
        const maxLines = Math.max(minLines, props.maxLines ?? 4);

        let minHeight = minLines * lineHeight + ELEMENT_PADDING;
        let maxHeight = maxLines * lineHeight + ELEMENT_PADDING;
        if (mode === 'fixed') minHeight = maxHeight;
        if (mode === 'fullscreen') maxHeight = 0; // unbounded; element fills parent

        return (
            <view
                class={props.class}
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    ...(mode === 'fullscreen' ? { flexGrow: 1, flexShrink: 1 } : {}),
                }}
            >
                <RichTextInput
                    value={mdToDoc(initialMd)}
                    placeholder={props.placeholder}
                    editable={props.disabled ? false : undefined}
                    minHeight={minHeight}
                    maxHeight={maxHeight}
                    fontSize={fontSize}
                    textColor={props.textColor}
                    accentColor={props.accentColor}
                    placeholderColor={props.placeholderColor}
                    confirmType={props.confirmType}
                    autoFocus={props.autoFocus}
                    style={
                        mode === 'fullscreen'
                            ? { flexGrow: 1 }
                            : { height: Math.max(minHeight, Math.min(reportedHeight.value || minHeight, maxHeight)) }
                    }
                    onElement={(handle) => {
                        el = handle;
                    }}
                    onHeightChange={(height) => {
                        reportedHeight.value = height;
                    }}
                    onChange={handleChange}
                    onSelection={(sel) => {
                        currentSel = sel;
                        props.onSelectionChange?.(sel);
                    }}
                    onFocus={() => props.onFocus?.()}
                    onBlur={() => props.onBlur?.()}
                />
            </view>
        );
    };
});
