// Primary: the SignalX-native streaming renderer — a Lynx adapter over
// `@sigx/richtext`'s render engine and `@sigx/richtext-markdown`'s
// incremental parser.
export { MarkdownView } from './render/MarkdownView.js';
export type { MarkdownViewProps } from './render/MarkdownView.js';

// The Lynx component map (design systems plug in here). The slot contract is
// `@sigx/richtext`'s `ComponentMap<E>` with `E` = a Lynx JSXElement.
export { defaultComponents } from './render/components.js';
export type { LynxMarkdownComponents, LynxMarkdownChild, LynxImageProps } from './render/components.js';

// The true-WYSIWYG editor surface lives on the `@sigx/lynx-markdown/editor`
// subpath (#177): `MarkdownEditor` / `SuggestionPopup` statically import the
// optional `@sigx/lynx-richtext` / `@sigx/lynx-keyboard` peers, and
// re-exporting them here would make those peers required at module-link time
// for every consumer - including renderer-only ones. This root entry carries
// no runtime peer imports beyond `@sigx/lynx` and the richtext packages.

// Reference plugin: the Lynx half here (candidates, popup row, the `kind`
// field on the chip), the node from `@sigx/richtext` and the `@[label](id)`
// syntax from `@sigx/richtext-markdown` (re-exported so a Lynx app keeps a
// single import).
export { createMentionPlugin, lynxMentionNode, mentionPlugin, mentionSyntax } from './plugins/mention.js';
export type { MentionPluginOptions, MentionCandidate, MentionComponentProps } from './plugins/mention.js';

// The richtext primitives a Lynx app reaches for: the streaming controller
// for AI token loops, the markdown format and its parser / engine, and the
// render engine for advanced consumers. Everything else (the serializer,
// `visit`, `sliceSource`, …) is one import away; both packages' types are
// re-exported below so `@sigx/lynx-daisyui` / `@sigx/lynx-emoji` keep a
// single pin.
export { createTextStream, renderDocument } from '@sigx/richtext';
export { createIncrementalEngine, markdownFormat, parseMarkdown } from '@sigx/richtext-markdown';
export type * from '@sigx/richtext';
export type * from '@sigx/richtext-markdown';
