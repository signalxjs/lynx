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

import { component, signal, useElementLayout, watch, type Define } from '@sigx/lynx';
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
import { mdToDoc, type MdToDocOptions } from './convert/mdToDoc.js';
import { docToMd, type DocToMdOptions, type SpanSerializer } from './convert/docToMd.js';
import { EditorToolbar, type ToolbarRenderItem } from './toolbar/Toolbar.js';
import { defaultToolbarItems, type ToolbarItem } from './toolbar/items.js';
import type { MarkdownEditorPlugin, TriggerItem, TriggerSelectApi } from './plugin.js';
import { createTriggerSessionManager, type TriggerSession } from './trigger/session.js';
import { SuggestionPopup } from './trigger/SuggestionPopup.js';

export type MarkdownEditorMode = 'auto' | 'fixed' | 'fullscreen';

/** Imperative command surface — what toolbars and plugins drive. */
export interface MarkdownEditorController {
    toggleBold(): void;
    toggleItalic(): void;
    toggleStrike(): void;
    toggleCode(): void;
    /** 1–6 sets a heading; 0 reverts to paragraph. */
    setHeading(level: 0 | 1 | 2 | 3 | 4 | 5 | 6): void;
    /**
     * Set the selected paragraph(s)' list type; `'none'` reverts to
     * paragraph. A new `'task'` line starts unchecked.
     */
    setList(kind: 'bullet' | 'ordered' | 'task' | 'none'): void;
    /** Toggle blockquote on the selected paragraph(s). */
    toggleQuote(): void;
    /**
     * Insert or wrap a link. Non-empty selection → the selection becomes the
     * link text; collapsed → `text` (or the href itself) is inserted and
     * linked. The href is trusted as-is (parse-side `sanitizeHref` and the
     * serializer's destination escaping are the safety nets); offsets come
     * from the last selection event — same fire-and-forget assumption as
     * `replaceRange`.
     */
    insertLink(href: string, text?: string): void;
    insertText(text: string): void;
    /**
     * Replace `[start, end)` (UTF-16 offsets in the document text) with
     * `text`, leaving the caret after it. What trigger plugins use to swap
     * the typed query for the selected suggestion.
     */
    replaceRange(start: number, end: number, text: string): void;
    /**
     * Insert an atomic mention chip (one U+FFFC carrying a `mention` span —
     * see lynx-richtext's chip invariant). `replace` removes `[from, to)`
     * first, typically the trigger query run. A dedicated native op:
     * `replaceRange`/`insertText` can't attach a span to the inserted char.
     */
    insertChip(chip: { id: string; label: string; kind?: string }, replace?: { from: number; to: number }): void;
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
    /**
     * Built-in formatting toolbar. `true` ≡ `'bottom'` — below the input is
     * the common chat placement (selection handles and the iOS edit menu pop
     * up *above* the selection, so a toolbar on top would sit under them).
     */
    & Define.Prop<'toolbar', boolean | 'top' | 'bottom', false>
    /** Override the built-in toolbar's items (defaults to `defaultToolbarItems`). */
    & Define.Prop<'toolbarItems', ToolbarItem[], false>
    /** Re-skin the built-in toolbar's item rendering (what daisyUI does). */
    & Define.Prop<'renderToolbarItem', ToolbarRenderItem, false>
    /**
     * Editor plugins ({@link MarkdownEditorPlugin}) — inline syntax, trigger
     * suggestions, extra toolbar items. Pass a stable array (e.g. a module
     * constant); the set is captured at mount.
     */
    & Define.Prop<'plugins', MarkdownEditorPlugin[], false>
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

    // --- plugins (captured at mount; pass a stable array) ---
    const plugins = props.plugins ?? [];
    const inlinePlugins = plugins.filter((p) => p.inline);
    // Duplicate identifiers would silently last-win (conversion maps) or make
    // trigger routing ambiguous (plugin name lookups) — flag the config error.
    const warnDuplicates = (key: string, values: string[]): void => {
        const seen = new Set<string>();
        for (const value of values) {
            if (seen.has(value)) {
                // Conversion maps resolve last-wins, trigger routing first-wins
                // — don't promise either; duplicates are a config error.
                console.warn(
                    `[MarkdownEditor] duplicate plugin ${key} "${value}" — resolution is ambiguous, rename to disambiguate.`,
                );
            }
            seen.add(value);
        }
    };
    warnDuplicates('name', plugins.map((p) => p.name));
    warnDuplicates('syntax.name', inlinePlugins.map((p) => p.inline!.syntax.name));
    warnDuplicates('docMapping.spanType', inlinePlugins.map((p) => p.inline!.docMapping.spanType));
    // Trigger routing is first-match-wins — a duplicate char/pattern means the
    // later plugin's trigger is silently unreachable.
    warnDuplicates(
        'trigger',
        plugins
            .filter((p) => p.trigger)
            .map((p) => (p.trigger!.char !== undefined ? `char:${p.trigger!.char}` : `pattern:${p.trigger!.pattern}`)),
    );
    const convertIn: MdToDocOptions | undefined = inlinePlugins.length
        ? {
            extensions: inlinePlugins.map((p) => p.inline!.syntax),
            spanMappers: Object.fromEntries(
                inlinePlugins.map((p) => [p.inline!.syntax.name, p.inline!.docMapping.toSpan]),
            ),
        }
        : undefined;
    const convertOut: DocToMdOptions | undefined = inlinePlugins.length
        ? {
            serializers: new Map<string, SpanSerializer>(
                inlinePlugins.map((p) => [
                    p.inline!.docMapping.spanType,
                    (span, text) => p.inline!.serialize(span, text),
                ]),
            ),
        }
        : undefined;
    const pluginToolbarItems = plugins.flatMap((p) => p.toolbar ?? []);

    // --- sync state (see module docs) ---
    const initialMd = typeof props.value === 'string' ? props.value : '';
    let lastEmittedMd: string | null = initialMd;
    let lastDocFromElement: RichDoc = normalizeDoc(mdToDoc(initialMd, 0, convertIn));
    let lastSeenVersion = 0;
    let composing = false;
    let pendingExternal: string | null = null;
    // Reactive box (not a plain var): the built-in toolbar derives active
    // states from it, so selection events must re-render.
    const selBox = signal<{ current: SelectionState | null }>({ current: null });

    // Auto-grow: the native element reports its (clamped) content height and
    // the editor feeds it back as the element's layout height — Lynx layout
    // sizes views from styles, never from native intrinsic content.
    const reportedHeight = signal(0);

    // --- trigger sessions (suggestion popup) ---
    const triggers = plugins
        .filter((p) => p.trigger)
        .map((p) => ({ plugin: p.name, spec: p.trigger! }));
    // Boxed like selBox: signal values must be objects.
    const sessionBox = signal<{ current: TriggerSession | null }>({ current: null });
    const triggerManager = triggers.length
        ? createTriggerSessionManager({
            triggers,
            onUpdate: (s) => {
                sessionBox.current = s;
            },
        })
        : null;
    // Page-absolute frame of the input's relative wrapper — the popup needs
    // it to relate the element-local caret rect to the keyboard.
    const { layout: inputFrame, onLayoutChange: onInputLayout } = useElementLayout();

    const applyExternal = (md: string): void => {
        if (md === lastEmittedMd) return; // our own echo
        if (composing) {
            pendingExternal = md;
            return;
        }
        const doc = mdToDoc(md, lastSeenVersion, convertIn);
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
        triggerManager?.syncText(doc.text);
        if (isComposing) return;
        const md = docToMd(doc, convertOut);
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
        setList: (kind) => {
            if (kind === 'none') RichTextMethods.setBlockType(el, 'paragraph');
            else if (kind === 'task') RichTextMethods.setBlockType(el, 'task', undefined, false);
            else RichTextMethods.setBlockType(el, kind);
        },
        toggleQuote: () => {
            const active = selBox.current?.activeBlock === 'blockquote';
            RichTextMethods.setBlockType(el, active ? 'paragraph' : 'blockquote');
        },
        insertLink: (href, text) => {
            const sel = selBox.current;
            if (sel && sel.end > sel.start) {
                RichTextMethods.applyFormat(el, 'link', sel.start, sel.end, { href });
                return;
            }
            const label = text ?? href;
            if (label === '') return;
            const start = sel?.start ?? 0;
            RichTextMethods.insertText(el, label);
            RichTextMethods.applyFormat(el, 'link', start, start + label.length, { href });
        },
        insertText: (text) => RichTextMethods.insertText(el, text),
        replaceRange: (start, end, text) => {
            // insertText replaces the selection — two existing fire-and-forget
            // commands compose into a range replace (no new native method).
            RichTextMethods.setSelectionRange(el, start, end);
            RichTextMethods.insertText(el, text);
        },
        insertChip: (chip, replace) => RichTextMethods.insertChip(el, chip, replace),
        clear: () => RichTextMethods.setDocument(el, emptyDoc(lastSeenVersion)),
        focus: () => RichTextMethods.focus(el),
        blur: () => RichTextMethods.blur(el),
        getMarkdown: () => lastEmittedMd ?? '',
        getSelection: () => selBox.current,
    };
    props.controllerRef?.(controller);

    const handleTriggerSelect = (item: TriggerItem): void => {
        const session = triggerManager?.session;
        if (!session) return;
        const spec = plugins.find((p) => p.name === session.plugin)?.trigger;
        if (!spec) return;
        const range = { start: session.anchor, end: session.caret };
        const api: TriggerSelectApi = {
            replaceQuery: (text) => controller.replaceRange(range.start, range.end, text),
            range,
            controller,
        };
        triggerManager!.close();
        spec.onSelect(item, api);
    };

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

        const toolbarPlacement = props.toolbar === true ? 'bottom' : props.toolbar;
        // Plugin items append after the base set (explicit `toolbarItems` wins
        // as the base, otherwise the defaults).
        const toolbarItems = pluginToolbarItems.length
            ? [...(props.toolbarItems ?? defaultToolbarItems), ...pluginToolbarItems]
            : props.toolbarItems;
        const toolbarNode = toolbarPlacement
            ? (
                <EditorToolbar
                    controller={controller}
                    selection={selBox.current}
                    items={toolbarItems}
                    renderItem={props.renderToolbarItem}
                />
            )
            : null;

        const session = sessionBox.current;
        const activeTrigger = session
            ? plugins.find((p) => p.name === session.plugin)?.trigger
            : undefined;
        // Gate on the wrapper frame being measured — before the first
        // bindlayoutchange the placement math would clamp against a 0-height
        // container and misposition the popup.
        const popupNode = session && activeTrigger && session.items.length > 0 && inputFrame.value
            ? (
                <SuggestionPopup
                    items={session.items}
                    caretRect={selBox.current?.caretRect ?? null}
                    containerFrame={inputFrame.value}
                    renderItem={activeTrigger.renderItem}
                    onSelect={handleTriggerSelect}
                />
            )
            : null;

        const inputNode = (
            <RichTextInput
                value={mdToDoc(initialMd, 0, convertIn)}
                placeholder={props.placeholder}
                editable={props.disabled !== true}
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
                    selBox.current = sel;
                    triggerManager?.syncCaret(sel.start === sel.end ? sel.start : -1);
                    props.onSelectionChange?.(sel);
                }}
                onFocus={() => props.onFocus?.()}
                onBlur={() => {
                    triggerManager?.close();
                    props.onBlur?.();
                }}
            />
        );

        return (
            <view
                class={props.class}
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    // Lynx hit-tests out-of-bounds children only when EVERY
                    // ancestor between the touch and the target reports
                    // overflow visible (LynxUI.containsPoint) — required for
                    // the above-the-caret suggestion popup to be tappable.
                    overflow: 'visible',
                    ...(mode === 'fullscreen' ? { flexGrow: 1, flexShrink: 1 } : {}),
                }}
            >
                {toolbarPlacement === 'top' ? toolbarNode : null}
                {triggers.length
                    ? (
                        // Relative layer the popup positions in; measured so the
                        // popup can clamp against the keyboard in page coords.
                        // overflow visible: the above-the-caret popup extends past
                        // this layer's top — it must stay hit-testable there, or
                        // taps fall through to non-ignore-focus chrome and blur
                        // the editor instead of selecting.
                        <view
                            bindlayoutchange={onInputLayout}
                            style={{
                                position: 'relative',
                                overflow: 'visible',
                                ...(mode === 'fullscreen'
                                    ? { display: 'flex', flexDirection: 'column', flexGrow: 1 }
                                    : {}),
                            }}
                        >
                            {inputNode}
                            {popupNode}
                        </view>
                    )
                    : inputNode}
                {toolbarPlacement === 'bottom' ? toolbarNode : null}
            </view>
        );
    };
});
