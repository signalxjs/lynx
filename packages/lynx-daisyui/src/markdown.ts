// @sigx/lynx-daisyui/markdown — daisyUI rendering + editor theming for the
// optional `@sigx/lynx-markdown` peer. Kept OFF the root barrel so importing
// `@sigx/lynx-daisyui` never forces markdown resolution. Apps using these
// install the peer and import from this subpath:
//
//   import { markdownComponents, EditorToolbar } from '@sigx/lynx-daisyui/markdown';
export { markdownComponents } from './markdown/components.js';
export { useMarkdownEditorTheme } from './markdown/editorTheme.js';
export type { MarkdownEditorThemeColors } from './markdown/editorTheme.js';
export { EditorToolbar, daisyToolbarItem } from './markdown/toolbar.js';
export type { EditorToolbarProps } from './markdown/toolbar.js';
