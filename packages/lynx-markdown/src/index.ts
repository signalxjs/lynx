// Primary: the SignalX-native streaming renderer. (An editable `MarkdownEditor`
// is planned as a sibling export.)
export { MarkdownView } from './render/MarkdownView.js';
export type { MarkdownViewProps } from './render/MarkdownView.js';

// Generic render-function override API (design systems plug in here).
export { defaultComponents } from './render/components.js';
export type {
    MarkdownComponents,
    MarkdownChild,
    RootProps,
    HeadingProps,
    ParagraphProps,
    BlockquoteProps,
    ListProps,
    ListItemProps,
    CodeProps,
    ThematicBreakProps,
    TableProps,
    TableRowProps,
    TableCellProps,
    StrongProps,
    EmProps,
    DelProps,
    CodeSpanProps,
    LinkProps,
    AutolinkProps,
    ImageProps,
    ExtensionProps,
} from './render/components.js';

// True-WYSIWYG editor on the native <sigx-richtext> element
// (requires the optional @sigx/lynx-richtext peer).
export { MarkdownEditor } from './editor/MarkdownEditor.js';
export type {
    MarkdownEditorProps,
    MarkdownEditorController,
    MarkdownEditorMode,
} from './editor/MarkdownEditor.js';
export type { SelectionState } from '@sigx/lynx-richtext';
export { EditorToolbar } from './editor/toolbar/Toolbar.js';
export type { EditorToolbarProps, ToolbarRenderItem } from './editor/toolbar/Toolbar.js';
export { defaultToolbarItems } from './editor/toolbar/items.js';
export type { ToolbarItem, ToolbarContext } from './editor/toolbar/items.js';
export { mdToDoc } from './editor/convert/mdToDoc.js';
export type { MdToDocOptions, ExtensionSpanMapper } from './editor/convert/mdToDoc.js';
export { docToMd } from './editor/convert/docToMd.js';
export type { DocToMdOptions, SpanSerializer } from './editor/convert/docToMd.js';

// Editor plugin API (P3): inline syntax + doc mapping, trigger suggestions,
// toolbar contributions — see MarkdownEditorPlugin.
export type {
    MarkdownEditorPlugin,
    InlinePluginSpec,
    TriggerSpec,
    TriggerItem,
    TriggerSelectApi,
} from './editor/plugin.js';
export { SuggestionPopup } from './editor/trigger/SuggestionPopup.js';
export type { SuggestionPopupProps, SuggestionRenderItem } from './editor/trigger/SuggestionPopup.js';
export { createTriggerSessionManager } from './editor/trigger/session.js';
export type { TriggerSession, TriggerSessionManager } from './editor/trigger/session.js';

// Reference plugins.
export { createMentionPlugin, mentionSyntax } from './plugins/mention.js';
export type { MentionPluginOptions, MentionCandidate } from './plugins/mention.js';

// Streaming controller for AI token loops.
export { createMarkdownStream } from './stream.js';
export type { MarkdownStream, CreateMarkdownStreamOptions } from './stream.js';

// Parser primitives (for advanced consumers / testing).
export { createIncrementalEngine } from './parser/incremental.js';
export type { IncrementalEngine, IncrementalEngineOptions } from './parser/incremental.js';
export { parseBlocks } from './parser/blocks.js';
export { parseInline } from './parser/inline.js';

// Parser inline-extension API (plugins add inline constructs here).
export type { ParserInlineExtension } from './parser/extensions.js';

// AST node types.
export type * from './ast.js';
