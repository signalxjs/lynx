// Primary: the SignalX-native streaming renderer — a Lynx adapter over
// `@sigx/markdown`'s incremental parser and platform-neutral render engine.
export { MarkdownView } from './render/MarkdownView.js';
export type { MarkdownViewProps } from './render/MarkdownView.js';

// The Lynx component map (design systems plug in here). The slot contract is
// `@sigx/markdown`'s `MarkdownComponents<E>` with `E` = a Lynx JSXElement.
export { defaultComponents } from './render/components.js';
export type { LynxMarkdownComponents, LynxMarkdownChild, LynxImageProps } from './render/components.js';

// The true-WYSIWYG editor surface lives on the `@sigx/lynx-markdown/editor`
// subpath (#177): `MarkdownEditor` / `SuggestionPopup` statically import the
// optional `@sigx/lynx-richtext` / `@sigx/lynx-keyboard` peers, and
// re-exporting them here would make those peers required at module-link time
// for every consumer - including renderer-only ones. This root entry carries
// no runtime peer imports beyond `@sigx/lynx` and `@sigx/markdown`.

// Reference plugin: the editor half here, the syntax/serializer half from
// `@sigx/markdown` (re-exported so a Lynx app keeps a single import).
export { createMentionPlugin, mentionPlugin, mentionSyntax } from './plugins/mention.js';
export type { MentionPluginOptions, MentionCandidate, MentionComponentProps } from './plugins/mention.js';

// `@sigx/markdown` primitives a Lynx app reaches for: the streaming controller
// for AI token loops, the parser/engine, and the render engine for advanced
// consumers. Everything else (the serializer, `visit`, `sliceSource`, …) is one
// `@sigx/markdown` import away; its types are all re-exported below so
// `@sigx/lynx-daisyui` / `@sigx/lynx-emoji` keep a single pin.
export { createMarkdownStream, createIncrementalEngine, parseMarkdown, renderDocument } from '@sigx/markdown';
export type * from '@sigx/markdown';
