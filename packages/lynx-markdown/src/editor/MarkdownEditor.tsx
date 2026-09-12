/**
 * `<MarkdownEditor>` — the Lynx block editor: the surface host of
 * `@sigx/markdown/editor`'s block-tree core on `<sigx-richtext>`.
 *
 * One `createEditor()` per component; every root block renders as a keyed
 * `<BlockView>` (paragraphs and headings as native rich-text fields in
 * `boundary-keys` mode, code blocks as textareas, lists / quotes / tables as
 * views). Structural sharing in the core state means an untouched block is
 * never re-rendered or re-mounted. The document is the mdast `Root` the
 * whole sigx estate shares; markdown in and out through `value` /
 * `onChange`, the tree through `document` / `onDocumentChange`.
 *
 * Chrome: a toolbar over the core's `defaultToolbarItems` (plus plugin
 * items), the suggestion popup driven by the core's trigger sessions
 * (rendered inside the block the session belongs to, so a container
 * translated on the main thread cannot misplace it), and — for hosts that
 * dock their own surface — `renderSuggestions` / `suggestions="none"` and
 * `onTriggerSession` (#755).
 *
 * The keyboard: Enter, Backspace at a block's start, Delete at its end,
 * arrows off the first / last line, Tab and Escape reach the core through
 * `bindboundarykey` (`@sigx/lynx-richtext` 0.30+); on an older native build
 * a typed newline still splits the block (the surface strips it), while the
 * edge deletes stay in-block.
 */

import { component, signal, useFontScale, watch, type Define, type JSXElement } from '@sigx/lynx';
import { defineProvide } from '@sigx/lynx';
import { useKeyboard } from '@sigx/lynx-keyboard';
import type { MarkdownPlugin, Root } from '@sigx/markdown';
import { mentionPlugin, parseMarkdown, toMarkdown } from '@sigx/markdown';
import type { Command, Editor, EditorSelection, InputRule, Keymap, ToolbarItem, Transaction, TriggerItem, TriggerSelectApi, TriggerSession, TriggerSessionManager } from '@sigx/markdown/editor';
import { commandRegistry, commands as C, createEditor, createTriggerSessionManager, textSelection } from '@sigx/markdown/editor';
import { lynxMentionInlineKind } from '../plugins/mention.js';
import { Platform } from '@sigx/lynx';
import { defaultComponents, type LynxMarkdownComponents } from '../render/components.js';
import { BlockView } from './blocks.js';
import { EditorToolbar, type ToolbarRenderItem } from './toolbar/Toolbar.js';
import { derivePopupStyleFromText, type SuggestionPopupStyle, type SuggestionRenderItem } from './trigger/SuggestionPopup.js';
import { createLynxEditorView, track, useLynxEditorView, type LynxEditorView } from './view.js';

export type MarkdownEditorMode = 'auto' | 'fixed' | 'fullscreen';

/** A trigger spec may carry a Lynx row renderer for the built-in popup. */
export interface LynxTriggerExtras {
    renderItem?: SuggestionRenderItem;
}

/** What `renderSuggestions` receives — enough to draw and drive a docked list. */
export interface SuggestionsApi {
    session: TriggerSession;
    activeIndex: number;
    setActive(index: number): void;
    pick(item: TriggerItem): void;
    close(): void;
}

/**
 * The imperative surface (`controllerRef`). Commands act on the current
 * selection; `run` reaches every core command by function or registered
 * name.
 */
export interface MarkdownEditorController {
    /** The core editor instance (state, history, dispatch, …). */
    readonly editor: Editor;
    run(command: Command | string): boolean;
    toggleBold(): void;
    toggleItalic(): void;
    toggleStrike(): void;
    toggleCode(): void;
    /** 1–6 sets a heading; 0 reverts to paragraph. */
    setHeading(level: 0 | 1 | 2 | 3 | 4 | 5 | 6): void;
    /** Wrap in / switch / leave a list; `'none'` unwraps. */
    setList(kind: 'bullet' | 'ordered' | 'task' | 'none'): void;
    toggleQuote(): void;
    /** Link the selection, or insert `text` (default the href) linked when collapsed. */
    insertLink(href: string, text?: string): void;
    insertText(text: string): void;
    /** Replace `[start, end)` of the current block with `text`, caret after it. */
    replaceRange(start: number, end: number, text: string): void;
    /** Insert an atom chip (a mention by default) at the caret, optionally replacing `[from, to)` of the current block. */
    insertChip(chip: { id: string; label: string; kind?: string }, replace?: { from: number; to: number }): void;
    clear(): void;
    openFullscreen(): void;
    closeFullscreen(): void;
    isFullscreen(): boolean;
    focus(): void;
    blur(): void;
    getMarkdown(): string;
    getDocument(): Root;
    setMarkdown(markdown: string): void;
    setDocument(doc: Root): void;
    getSelection(): EditorSelection;
    undo(): boolean;
    redo(): boolean;
}

export type MarkdownEditorProps =
    /** Markdown source. An external change replaces the document (echoes of `onChange` are ignored). */
    & Define.Prop<'value', string, false>
    /** An mdast document instead of `value` (wins for the initial content; external changes replace the document). */
    & Define.Prop<'document', Root, false>
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
    /** `true` (bottom), `'top'` or `'bottom'` renders the built-in toolbar. */
    & Define.Prop<'toolbar', boolean | 'top' | 'bottom', false>
    /** Base items (default: the core's `defaultToolbarItems`); plugin items append. */
    & Define.Prop<'toolbarItems', readonly ToolbarItem[], false>
    & Define.Prop<'renderToolbarItem', ToolbarRenderItem, false>
    /** Plugins: `@sigx/markdown` plugins with an editor slice. Captured at mount. */
    & Define.Prop<'plugins', readonly MarkdownPlugin[], false>
    /** Components for void blocks (dividers, definitions). */
    & Define.Prop<'components', Partial<LynxMarkdownComponents>, false>
    /** Colors and layout of the built-in suggestion popup. */
    & Define.Prop<'suggestionPopup', SuggestionPopupStyle, false>
    /** `'popup'` (default) renders the built-in popup by the caret; `'none'` leaves rendering to `renderSuggestions` / `onTriggerSession`. */
    & Define.Prop<'suggestions', 'popup' | 'none', false>
    /** Render the suggestion list yourself (docked in a composer bar, say); replaces the popup. */
    & Define.Prop<'renderSuggestions', (api: SuggestionsApi) => JSXElement | null, false>
    /** Observe trigger sessions (open, query and item updates, close). */
    & Define.Prop<'onTriggerSession', (session: TriggerSession | null) => void, false>
    & Define.Prop<'keymap', Keymap, false>
    & Define.Prop<'inputRules', readonly InputRule[] | false, false>
    & Define.Prop<'fullscreenClass', string, false>
    & Define.Prop<'onFullscreenChange', (open: boolean) => void, false>
    /** Markdown after every committed transaction (never mid-composition). */
    & Define.Prop<'onChange', (markdown: string) => void, false>
    & Define.Prop<'onDocumentChange', (doc: Root, transaction: Transaction) => void, false>
    & Define.Prop<'onSelectionChange', (selection: EditorSelection) => void, false>
    & Define.Prop<'onFocus', () => void, false>
    & Define.Prop<'onBlur', () => void, false>
    & Define.Prop<'controllerRef', (ctrl: MarkdownEditorController) => void, false>;

const DEFAULT_FONT_SIZE = 16;

const KeyboardSpacer = component(() => {
    const keyboard = useKeyboard();
    return () => <view style={{ height: keyboard.value.height }} />;
});

const clone = <T,>(doc: T): T => JSON.parse(JSON.stringify(doc)) as T;

export const MarkdownEditor = component<MarkdownEditorProps>(({ props, onUnmounted }) => {
    const fontScale = useFontScale();
    // Mentions are native to the field (`insertChip`), so the `@[label](id)`
    // syntax, serializer and atom kind are always present; a plugin named
    // `mention` (e.g. `createMentionPlugin`) replaces this baseline.
    const given = props.plugins ?? [];
    const plugins: readonly MarkdownPlugin[] = given.some((p) => p.name === 'mention')
        ? given
        : [...given, { ...mentionPlugin, editor: { inline: [lynxMentionInlineKind] } }];
    const parse = (md: string): Root => parseMarkdown(md, { plugins });
    const serialize = (doc: Root): string => toMarkdown(doc, { plugins });

    let lastEmittedMd: string | null = null;
    let lastEmittedDoc: Root | null = null;
    const initialDoc = props.document ? clone(props.document) : parse(typeof props.value === 'string' ? props.value : '');
    if (typeof props.value === 'string') lastEmittedMd = props.value;

    let view!: LynxEditorView;
    const offsetAt = (key: string, edge: 'first' | 'last'): number => {
        const s = view.surfaces.get(key);
        if (!s) return edge === 'first' ? 0 : Number.MAX_SAFE_INTEGER;
        return 'offsetAtX' in s ? s.offsetAtX(edge, 0) : edge === 'first' ? 0 : Number.MAX_SAFE_INTEGER;
    };

    const editor = createEditor({
        doc: initialDoc,
        plugins,
        keymap: { ArrowUp: C.focusNeighbour('up', offsetAt), ArrowDown: C.focusNeighbour('down', offsetAt), ...props.keymap },
        inputRules: props.inputRules,
        platform: { isMac: Platform.OS === 'ios', hasHardwareKeyboard: false, caretRectSpace: 'block' },
        parse,
        readOnly: props.disabled === true,
        onChange: ({ state, transaction }) => {
            lastEmittedDoc = state.doc;
            const md = serialize(state.doc);
            lastEmittedMd = md;
            props.onChange?.(md);
            props.onDocumentChange?.(state.doc, transaction);
        },
        onSelectionChange: (selection) => props.onSelectionChange?.(selection),
    });

    // --- trigger sessions ---------------------------------------------------
    const triggers: TriggerSessionManager | null = editor.triggers.length
        ? createTriggerSessionManager({
              triggers: editor.triggers,
              onUpdate: (s) => {
                  view.setSession(s);
                  props.onTriggerSession?.(s);
              },
          })
        : null;

    const pick = (item: TriggerItem): void => {
        const s = view.session();
        if (!s || !triggers) return;
        const spec = editor.triggers.find((t) => t.plugin === s.plugin)?.spec;
        if (!spec) return;
        const api: TriggerSelectApi = {
            replaceQuery(slice) {
                editor.dispatch({
                    steps: [{ type: 'replaceInline', key: s.key, from: s.anchor, to: s.caret, slice }],
                    selection: textSelection(s.key, s.anchor + slice.text.length),
                    meta: { origin: 'command' },
                });
            },
            range: { key: s.key, from: s.anchor, to: s.caret },
            commands: commandRegistry,
            dispatch: editor.dispatch,
            state: editor.state,
            run: (command) => editor.run(command),
        };
        triggers.close();
        spec.onSelect(item, api);
    };

    const fullscreenOpen = signal({ value: false });
    const setFullscreen = (open: boolean): void => {
        if (fullscreenOpen.value === open) return;
        fullscreenOpen.value = open;
        props.onFullscreenChange?.(open);
    };

    const components = (): LynxMarkdownComponents => (props.components ? { ...defaultComponents, ...props.components } : defaultComponents);

    view = createLynxEditorView({
        editor,
        readOnly: () => editor.readOnly,
        placeholder: () => props.placeholder,
        field: () => ({
            fontSize: Math.round((props.fontSize ?? DEFAULT_FONT_SIZE) * fontScale.value),
            textColor: props.textColor,
            accentColor: props.accentColor,
            placeholderColor: props.placeholderColor,
            confirmType: props.confirmType,
        }),
        components,
        popup: () => (props.suggestions ?? 'popup') === 'popup' && !props.renderSuggestions,
        popupStyle: () => ({ ...derivePopupStyleFromText(props.textColor), ...props.suggestionPopup }),
        renderSuggestion: (plugin) => (editor.triggers.find((t) => t.plugin === plugin)?.spec as LynxTriggerExtras | undefined)?.renderItem,
        pick,
        closeSession: () => triggers?.close(),
        onFocusChange: (key, previous) => {
            editor.focused(key);
            if (key && !previous) props.onFocus?.();
            if (!key && previous) {
                triggers?.close();
                props.onBlur?.();
            }
        },
    });
    defineProvide(useLynxEditorView, () => view);

    const stopListen = editor.listen((tr, state) => {
        if (!triggers) return;
        const sel = state.selection;
        if (sel?.mode === 'text') {
            const flat = editor.flatOf(sel.anchor.key);
            if (flat) {
                triggers.syncText(sel.anchor.key, flat.text);
                triggers.syncCaret(sel.anchor.key, sel.anchor.offset === sel.head.offset ? sel.anchor.offset : -1);
                return;
            }
        }
        triggers.close();
        void tr;
    });

    // --- inbound props --------------------------------------------------------
    watch(
        () => props.value,
        (md) => {
            if (typeof md !== 'string' || md === lastEmittedMd) return;
            lastEmittedMd = md;
            editor.setMarkdown(md);
        },
    );
    watch(
        () => props.document,
        (doc) => {
            if (!doc || doc === lastEmittedDoc) return;
            editor.setDocument(clone(doc));
        },
    );
    watch(
        () => props.disabled === true,
        (ro) => {
            if (editor.readOnly !== ro) {
                editor.readOnly = ro;
                for (const s of view.surfaces.values()) s.setReadOnly(ro);
            }
        },
    );

    // --- controller -----------------------------------------------------------
    const currentKey = (): string | null => {
        const sel = editor.state.selection;
        return sel?.mode === 'text' ? sel.anchor.key : null;
    };
    const controller: MarkdownEditorController = {
        editor,
        run: (command) => editor.run(command),
        toggleBold: () => void editor.run(commandRegistry.toggleStrong),
        toggleItalic: () => void editor.run(commandRegistry.toggleEmphasis),
        toggleStrike: () => void editor.run(commandRegistry.toggleDelete),
        toggleCode: () => void editor.run(commandRegistry.toggleInlineCode),
        setHeading: (level) => void editor.run(level === 0 ? commandRegistry.setParagraph : commandRegistry[`setHeading${level}` as 'setHeading1']),
        setList: (kind) => {
            if (kind === 'none') {
                const sel = editor.state.selection;
                const key = sel?.mode === 'text' ? sel.anchor.key : sel?.anchorKey;
                if (!key) return;
                // toggleList unwraps when the block is already in a list of that kind; find which.
                let entry = editor.state.index().get(key);
                while (entry && entry.node.type !== 'list' && entry.parentKey) entry = editor.state.index().get(entry.parentKey);
                const list = entry?.node.type === 'list' ? (entry.node as { ordered?: boolean; children: { checked?: boolean | null }[] }) : null;
                if (!list) return;
                const current = list.children.some((i) => i.checked !== null && i.checked !== undefined) ? 'task' : list.ordered ? 'ordered' : 'bullet';
                editor.run(C.toggleList(current));
                return;
            }
            editor.run(C.toggleList(kind));
        },
        toggleQuote: () => void editor.run(C.wrapInBlockquote),
        insertLink: (href, text) => {
            const sel = editor.state.selection;
            if (sel?.mode === 'text' && sel.anchor.offset === sel.head.offset && text) {
                // Insert the text, select it, then link it.
                const key = sel.anchor.key;
                const from = sel.anchor.offset;
                editor.run(C.insertText(text));
                editor.setSelection(textSelection(key, from, from + text.length));
            }
            editor.run(C.setLink(href));
        },
        insertText: (text) => void editor.run(C.insertText(text)),
        replaceRange: (start, end, text) => {
            const key = currentKey();
            if (!key) return;
            editor.dispatch({
                steps: [{ type: 'replaceInline', key, from: start, to: end, slice: { text, spans: [] } }],
                selection: textSelection(key, start + text.length),
                meta: { origin: 'command' },
            });
        },
        insertChip: (chip, replace) => {
            const attrs: Record<string, string> = { id: chip.id, label: chip.label };
            if (chip.kind) attrs.kind = chip.kind;
            editor.run(C.insertAtom('mention', attrs, replace));
        },
        clear: () => void editor.run(commandRegistry.clear),
        openFullscreen: () => setFullscreen(true),
        closeFullscreen: () => setFullscreen(false),
        isFullscreen: () => fullscreenOpen.value,
        focus: () => {
            editor.run(C.focusEnd);
            const sel = editor.state.selection;
            if (sel?.mode === 'text') view.focusBlock(sel.anchor.key, { edge: 'end' });
        },
        blur: () => {
            const key = view.focusedKey();
            if (key) view.surfaces.get(key)?.blur();
        },
        getMarkdown: () => lastEmittedMd ?? serialize(editor.state.doc),
        getDocument: () => editor.state.doc,
        setMarkdown: (md) => void editor.setMarkdown(md),
        setDocument: (doc) => editor.setDocument(clone(doc)),
        getSelection: () => editor.state.selection,
        undo: () => editor.undo(),
        redo: () => editor.redo(),
    };
    props.controllerRef?.(controller);

    onUnmounted(() => {
        stopListen();
        triggers?.close();
        editor.destroy();
    });

    if (props.autoFocus) {
        // The first field mounts after this render; focus it on the next tick.
        setTimeout(() => controller.focus(), 0);
    }

    return () => {
        const mode = props.mode ?? 'auto';
        const overlay = fullscreenOpen.value;
        const fills = overlay || mode === 'fullscreen';
        const field = view.field();
        const lineHeight = Math.round(field.fontSize * 1.5);
        const minLines = Math.max(1, props.minLines ?? 1);
        const maxLines = Math.max(minLines, props.maxLines ?? 0);
        const toolbarPlacement = props.toolbar === true || (overlay && props.toolbar === undefined) ? 'bottom' : props.toolbar;
        const toolbarNode = toolbarPlacement ? <EditorToolbar controller={controller} items={props.toolbarItems} renderItem={props.renderToolbarItem} /> : null;
        track(editor.rev.value);
        const doc = editor.state.doc;
        const session = view.session();
        const docked = session && props.renderSuggestions
            ? props.renderSuggestions({
                  session,
                  activeIndex: view.activeIndex.value,
                  setActive: (i) => {
                      view.activeIndex.value = i;
                  },
                  pick,
                  close: () => triggers?.close(),
              })
            : null;

        const closeNode = overlay ? (
            <view style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end' }}>
                <view
                    ignore-focus
                    accessibility-element
                    accessibility-label="Close fullscreen"
                    accessibility-trait="button"
                    bindtap={() => setFullscreen(false)}
                    style={{ paddingTop: 8, paddingBottom: 8, paddingLeft: 16, paddingRight: 16 }}
                >
                    <text style={{ fontSize: 18 }}>✕</text>
                </view>
            </view>
        ) : null;

        const content = (
            <view
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'visible',
                    minHeight: minLines * lineHeight + 16,
                    ...(fills ? { flexGrow: 1 } : maxLines > minLines ? { maxHeight: maxLines * lineHeight + 16 } : {}),
                }}
            >
                {doc.children.map((block) => (
                    <BlockView key={block.key} block={block} />
                ))}
            </view>
        );

        return (
            <view
                class={overlay && props.fullscreenClass ? `${props.class ?? ''} ${props.fullscreenClass}`.trim() : props.class}
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'visible',
                    ...(mode === 'fullscreen' && !overlay ? { flexGrow: 1, flexShrink: 1 } : {}),
                    ...(overlay
                        ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, ...(props.fullscreenClass ? {} : { backgroundColor: '#ffffff' }) }
                        : {}),
                }}
            >
                {closeNode}
                {toolbarPlacement === 'top' ? toolbarNode : null}
                {maxLines > minLines && !fills ? <scroll-view scroll-y style={{ maxHeight: maxLines * lineHeight + 16 }}>{content}</scroll-view> : content}
                {docked}
                {toolbarPlacement === 'bottom' ? toolbarNode : null}
                {overlay ? <KeyboardSpacer /> : null}
            </view>
        );
    };
});
