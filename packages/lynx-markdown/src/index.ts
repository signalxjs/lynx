import './jsx-augment.js';

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

// Streaming controller for AI token loops.
export { createMarkdownStream } from './stream.js';
export type { MarkdownStream, CreateMarkdownStreamOptions } from './stream.js';

// Native `<x-markdown>` wrapper, preserved for platforms that ship the element.
export { XMarkdown } from './XMarkdown.js';
export type { XMarkdownProps, XMarkdownEffect } from './XMarkdown.js';

// Parser primitives (for advanced consumers / testing).
export { createIncrementalEngine } from './parser/incremental.js';
export type { IncrementalEngine } from './parser/incremental.js';
export { parseBlocks } from './parser/blocks.js';
export { parseInline } from './parser/inline.js';

// AST node types.
export type * from './ast.js';

// Native-element event types (used by XMarkdown consumers).
export type {
    XMarkdownAttributes,
    MarkdownLinkEvent,
    MarkdownLinkEventDetail,
    MarkdownImageTapEvent,
    MarkdownImageTapEventDetail,
    MarkdownParseEndEvent,
    MarkdownParseEndEventDetail,
} from './jsx-augment.js';
