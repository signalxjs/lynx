# @sigx/lynx-markdown

A **SignalX-native, streaming-aware markdown renderer** — and a true-WYSIWYG
editor — for Lynx.

It renders and edits [`@sigx/richtext`](https://sigx.dev/richtext/) trees
natively: the mdast-compatible incremental parser, the streaming controller and
the render engine live in `@sigx/richtext` / `@sigx/richtext-markdown` (shared with the web), and this
package maps the tree to native Lynx `<view>`/`<text>`/`<image>` primitives — so
it renders **identically on every platform** (iOS, Android, Harmony) and is fully
controllable from JS. Built for AI output: as the source string grows
token-by-token, finalized blocks keep a stable identity and are never re-parsed
or remounted, so completed content doesn't flicker or reflow while new tokens
stream in.

## 📚 Documentation

Full prop reference, streaming API, theming, the WYSIWYG editor and live examples → **[sigx.dev/lynx/modules/markdown/overview](https://sigx.dev/lynx/modules/markdown/overview/)**

## Install

```bash
pnpm add @sigx/lynx-markdown
```

(`@sigx/richtext` and `@sigx/richtext-markdown` come along as dependencies; their `@sigx/reactivity` /
`@sigx/runtime-core` peers are the ones `@sigx/lynx` already requires.)

## A taste

```tsx
import { MarkdownView } from '@sigx/lynx-markdown';

export default function ArticleScreen() {
  return (
    <MarkdownView
      value={'# Hello\n\nThis is **markdown** with a [link](https://sigx.dev).'}
      onLink={(url) => openUrl(url)}
    />
  );
}
```

`createTextStream()` (re-exported from `@sigx/richtext`) bridges a token loop to `<MarkdownView>` for AI output, coalescing bursts of tokens into a bounded number of re-renders. `MarkdownEditor` (from `@sigx/lynx-markdown/editor`) adds block-tree WYSIWYG editing on the native [`@sigx/lynx-richtext`](https://sigx.dev/lynx/modules/richtext/overview/) element — see below. The supported syntax, full prop tables, streaming API, theming and editor/toolbar contracts are documented on the docs site.

### Plugins and components

`<MarkdownView>` takes two maps that mirror `@sigx/richtext`'s:

- **`plugins`** — `@sigx/richtext` plugins (`RichTextPlugin[]`: node specs, plus markdown syntax and serializer rules under `formats.markdown`). Pass a stable array; changing its identity re-parses from scratch. `mentionPlugin` (the `@[label](id)` syntax) is re-exported here.
- **`components`** — a partial `ComponentMap<JSXElement>` (alias `LynxMarkdownComponents`) keyed by mdast node type: `root`, `paragraph`, `heading` (`depth`), `blockquote`, `list` (`ordered`, `start`, `spread`), `listItem` (`ordered`, `index`, `number`, `checked`, `spread`), `code` (`value`, `lang`, `meta`, `open`), `thematicBreak`, `table` (`align`), `tableRow` (`header`, `index`), `tableCell` (`header`, `align`, `index`), `html`, `text`, `emphasis`, `strong`, `delete`, `inlineCode`, `break`, `link` (`url`, `title`, `autolink`, `onLink`), `image` (`url`, `alt`, `title`, plus this package's `onImageTap`) — and one flat slot per plugin node type (`components.mention`, `components.emoji`). Unspecified slots fall back to the neutral `defaultComponents`; a ready-made daisyUI mapping ships in [`@sigx/lynx-daisyui`](https://sigx.dev/lynx/modules/daisyui/overview/).

```tsx
import { MarkdownView, mentionPlugin, type Mention } from '@sigx/lynx-markdown';

<MarkdownView
  value="ping @[Andy](u1)"
  plugins={[mentionPlugin]}
  components={{ mention: ({ node }: { node: Mention }) => <text class="chip">@{node.label}</text> }}
/>
```

Link and image URLs are sanitised by the engine before a component sees them (`javascript:` and friends become `#`).

### Editor

`@sigx/lynx-markdown/editor` is the Lynx host of the block-tree editor core in
[`@sigx/richtext/editor`](https://sigx.dev/richtext/editor/): one `createEditor()`
per `<MarkdownEditor>`, the mdast `Root` as the document, and every root block
rendered as a keyed `BlockView` — paragraphs and headings as native
`<sigx-richtext boundary-keys>` fields, code blocks as a `<textarea>`, lists /
quotes / tables as views. State, history, commands, keymap, input rules (`# `,
`- `, `1. `, `- [ ] `, `> `, `**bold**`, …), plugins and trigger sessions all
live in the core and behave the same as on the web; this package only maps
them onto Lynx. The entry is opt-in because it makes the optional
`@sigx/lynx-richtext` and `@sigx/lynx-keyboard` peers real requirements.

```tsx
import { MarkdownEditor, createSlashPlugin, type MarkdownEditorController } from '@sigx/lynx-markdown/editor';
import { createMentionPlugin } from '@sigx/lynx-markdown';

const mention = createMentionPlugin({ search: (q) => users.filter((u) => u.label.includes(q)) });
let ctrl: MarkdownEditorController | null = null;

<MarkdownEditor
  value={draft.value}
  onChange={(md) => { draft.value = md; }}
  plugins={[mention, createSlashPlugin()]}
  toolbar="bottom"
  placeholder="Write…"
  controllerRef={(c) => { ctrl = c; }}
/>
```

- **Document in, document out** — `value` / `onChange(markdown)` for markdown,
  `document` / `onDocumentChange(doc, transaction)` for the tree (bind either or
  both; an inbound value equal to what the editor last emitted is ignored).
- **Keyboard** — Enter splits, Backspace at a block's start / Delete at its end
  join, arrows off the first / last line move between blocks, Tab / Shift-Tab
  indent list items, Escape selects the block. These reach the core through the
  element's `bindboundarykey`; on a native build without it, a typed newline
  still splits the block but the edge deletes stay in-block.
- **Plugins** — the same `RichTextPlugin[]` `<MarkdownView>` takes; a plugin's
  `editor` slice adds inline kinds, triggers, toolbar items, commands, keymap
  bindings and input rules. `createMentionPlugin` (`@` with candidate search)
  and the core's `createSlashPlugin` (`/` block menu) ship ready-made; a
  baseline mention plugin is always registered so `controller.insertChip()`
  round-trips.
- **Suggestions** — the built-in popup renders inside the block the session
  belongs to (`suggestionPopup` styles it). Hosts that dock their own list pass
  `suggestions="none"` and draw from `renderSuggestions(api)` /
  `onTriggerSession(session)`.
- **Controller** — `controllerRef` yields the formatting shortcuts
  (`toggleBold`, `setHeading`, `setList`, `insertLink`, `insertChip`, …),
  `getMarkdown` / `setMarkdown`, `getDocument` / `setDocument`, `undo` / `redo`,
  focus and fullscreen — plus `editor` (the core instance) and
  `run(command | name)` for everything else.
- **Toolbar** — `toolbar` / `toolbarItems` / `renderToolbarItem`, or place
  `<EditorToolbar controller={ctrl}>` yourself; active / enabled states come
  from the core's `toolbarState`. A daisyUI skin ships in `@sigx/lynx-daisyui`.
- **Composing your own layout** — `BlockView`, `InlineBlock`, `CodeBlock`,
  `createLynxEditorView` and the surfaces (`createLynxInlineSurface`,
  `createLynxCodeSurface`, `flatToDoc` / `docToFlat`) are exported for hosts
  that need more than the component.

`MarkdownEditor` follows the OS text-size setting: `fontSize` (default 16) is the size at the default system setting, multiplied by the effective font scale — and the auto-grow window (`minLines`/`maxLines`) scales with it, live. Raw `RichTextInput` does not auto-scale; multiply its `fontSize` by `useFontScale()` (from `@sigx/lynx`) if you use it directly.

## License

MIT
