// @sigx/lynx-markdown/editor — the block-tree editor surface for Lynx.
//
// Split from the package root (#177) so the root stays renderer/parser-only:
// `MarkdownEditor` statically imports the native `@sigx/lynx-richtext`
// element and `SuggestionPopup` imports `@sigx/lynx-keyboard` — both optional
// peers, which in ESM the root's static re-exports made required at
// module-link time for every consumer, including renderer-only ones.
// Importing THIS subpath is the opt-in that makes those peers real
// requirements; the root carries no runtime peer imports.
//
// The editor core (state, commands, keymap, input rules, plugins) is
// `@sigx/markdown/editor`; this entry is its Lynx host: the component, the
// `<sigx-richtext>` / `<textarea>` surfaces and the Lynx chrome.

export { MarkdownEditor } from './MarkdownEditor.js';
export type {
    MarkdownEditorProps,
    MarkdownEditorController,
    MarkdownEditorMode,
    SuggestionsApi,
    LynxTriggerExtras,
} from './MarkdownEditor.js';
export type { SelectionState } from '@sigx/lynx-richtext';

export { EditorToolbar } from './toolbar/Toolbar.js';
export type { EditorToolbarProps, ToolbarRenderItem } from './toolbar/Toolbar.js';
export { defaultToolbarItems, toolbarState } from './toolbar/items.js';
export type { ToolbarItem, ToolbarContext, ToolbarState } from './toolbar/items.js';

export { BlockView, InlineBlock, CodeBlock } from './blocks.js';
export type { BlockViewProps, InlineBlockProps } from './blocks.js';
export { useLynxEditorView, createLynxEditorView } from './view.js';
export type { LynxEditorView, EditorFieldStyle } from './view.js';

export { createLynxInlineSurface } from './surface/inline-surface.js';
export type { LynxInlineSurface, LynxInlineSurfaceOptions, LynxInlineSurfaceNative, RichTextCommands } from './surface/inline-surface.js';
export { createLynxCodeSurface } from './surface/code-surface.js';
export type { LynxCodeSurface, LynxCodeSurfaceOptions, LynxCodeSurfaceNative } from './surface/code-surface.js';
export { flatToDoc, docToFlat, blockAttrFor } from './surface/rich-doc.js';

export { SuggestionPopup, derivePopupStyleFromText } from './trigger/SuggestionPopup.js';
export type {
    SuggestionPopupProps,
    SuggestionRenderItem,
    SuggestionPopupStyle,
} from './trigger/SuggestionPopup.js';

// The core's editor API, re-exported so a Lynx app keeps a single import:
// plugins with an editor slice, the slash plugin, the trigger session
// machinery and every command.
export {
    createSlashPlugin,
    createMentionPlugin as createCoreMentionPlugin,
    createTriggerSessionManager,
    commands,
    commandRegistry,
    createEditor,
} from '@sigx/markdown/editor';
export type {
    Editor,
    EditorOptions,
    EditorState,
    EditorSelection,
    EditorPlugin,
    EditorPluginSlice,
    Command,
    CommandContext,
    Keymap,
    InputRule,
    Transaction,
    TriggerSpec,
    TriggerItem,
    TriggerSelectApi,
    TriggerSession,
    TriggerSessionManager,
    SlashItem,
    SlashPluginOptions,
    MentionItem,
    InlineFlat,
    InlineSpan,
} from '@sigx/markdown/editor';
