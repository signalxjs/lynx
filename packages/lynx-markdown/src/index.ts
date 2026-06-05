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
} from './render/components.js';

// True-WYSIWYG editor on the native <sigx-richtext> element
// (requires the optional @sigx/lynx-richtext peer).
export { MarkdownEditor } from './editor/MarkdownEditor.js';
export type {
    MarkdownEditorProps,
    MarkdownEditorController,
    MarkdownEditorMode,
} from './editor/MarkdownEditor.js';
export { mdToDoc } from './editor/convert/mdToDoc.js';
export { docToMd } from './editor/convert/docToMd.js';

// Streaming controller for AI token loops.
export { createMarkdownStream } from './stream.js';
export type { MarkdownStream, CreateMarkdownStreamOptions } from './stream.js';

// Parser primitives (for advanced consumers / testing).
export { createIncrementalEngine } from './parser/incremental.js';
export type { IncrementalEngine } from './parser/incremental.js';
export { parseBlocks } from './parser/blocks.js';
export { parseInline } from './parser/inline.js';

// AST node types.
export type * from './ast.js';
