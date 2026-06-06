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

// The true-WYSIWYG editor surface lives on the `@sigx/lynx-markdown/editor`
// subpath (#177): `MarkdownEditor` / `SuggestionPopup` statically import the
// optional `@sigx/lynx-richtext` / `@sigx/lynx-keyboard` peers, and
// re-exporting them here would make those peers required at module-link time
// for every consumer - including renderer-only ones. This root entry carries
// no runtime peer imports.

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
