// @sigx/lynx-markdown/editor — the true-WYSIWYG editor surface.
//
// Split from the package root (#177) so the root stays renderer/parser-only:
// `MarkdownEditor` statically imports the native `@sigx/lynx-richtext`
// element and `SuggestionPopup` imports `@sigx/lynx-keyboard` — both optional
// peers, which in ESM the root's static re-exports made required at
// module-link time for every consumer, including renderer-only ones.
// Importing THIS subpath is the opt-in that makes those peers real
// requirements; the root carries no runtime peer imports.

export { MarkdownEditor } from './MarkdownEditor.js';
export type {
    MarkdownEditorProps,
    MarkdownEditorController,
    MarkdownEditorMode,
} from './MarkdownEditor.js';
export type { SelectionState } from '@sigx/lynx-richtext';

export { EditorToolbar } from './toolbar/Toolbar.js';
export type { EditorToolbarProps, ToolbarRenderItem } from './toolbar/Toolbar.js';
export { defaultToolbarItems } from './toolbar/items.js';
export type { ToolbarItem, ToolbarContext } from './toolbar/items.js';

export { mdToDoc } from './convert/mdToDoc.js';
export type { MdToDocOptions, ExtensionSpanMapper } from './convert/mdToDoc.js';
export { docToMd } from './convert/docToMd.js';
export type { DocToMdOptions, SpanSerializer } from './convert/docToMd.js';

// Editor plugin API (P3): inline syntax + doc mapping, trigger suggestions,
// toolbar contributions — see MarkdownEditorPlugin.
export type {
    MarkdownEditorPlugin,
    InlinePluginSpec,
    TriggerSpec,
    TriggerItem,
    TriggerSelectApi,
} from './plugin.js';
export { SuggestionPopup } from './trigger/SuggestionPopup.js';
export type {
    SuggestionPopupProps,
    SuggestionRenderItem,
    SuggestionPopupStyle,
} from './trigger/SuggestionPopup.js';
export { createTriggerSessionManager } from './trigger/session.js';
export type { TriggerSession, TriggerSessionManager } from './trigger/session.js';
