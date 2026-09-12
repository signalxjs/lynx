# @sigx/lynx-markdown

A **SignalX-native, streaming-aware markdown renderer** — and a true-WYSIWYG
editor — for Lynx.

It renders and edits [`@sigx/markdown`](https://sigx.dev/markdown/) trees
natively: the mdast-compatible incremental parser, the streaming controller and
the render engine live in `@sigx/markdown` (shared with the web), and this
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

(`@sigx/markdown` comes along as a dependency; its `@sigx/reactivity` /
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

`createMarkdownStream()` (re-exported from `@sigx/markdown`) bridges a token loop to `<MarkdownView>` for AI output, coalescing bursts of tokens into a bounded number of re-renders. `MarkdownEditor` adds true-WYSIWYG editing on the native [`@sigx/lynx-richtext`](https://sigx.dev/lynx/modules/richtext/overview/) element. The supported syntax, full prop tables, streaming API, theming and editor/toolbar contracts are documented on the docs site.

### Plugins and components

`<MarkdownView>` takes two maps that mirror `@sigx/markdown`'s:

- **`plugins`** — `@sigx/markdown` plugins (`MarkdownPlugin[]`: inline/block syntax, serializer rules). Pass a stable array; changing its identity re-parses from scratch. `mentionPlugin` (the `@[label](id)` syntax) is re-exported here.
- **`components`** — a partial `MarkdownComponents<JSXElement>` (alias `LynxMarkdownComponents`) keyed by mdast node type: `root`, `paragraph`, `heading` (`depth`), `blockquote`, `list` (`ordered`, `start`, `spread`), `listItem` (`ordered`, `index`, `number`, `checked`, `spread`), `code` (`value`, `lang`, `meta`, `open`), `thematicBreak`, `table` (`align`), `tableRow` (`header`, `index`), `tableCell` (`header`, `align`, `index`), `html`, `text`, `emphasis`, `strong`, `delete`, `inlineCode`, `break`, `link` (`url`, `title`, `autolink`, `onLink`), `image` (`url`, `alt`, `title`, plus this package's `onImageTap`) — and one flat slot per plugin node type (`components.mention`, `components.emoji`). Unspecified slots fall back to the neutral `defaultComponents`; a ready-made daisyUI mapping ships in [`@sigx/lynx-daisyui`](https://sigx.dev/lynx/modules/daisyui/overview/).

```tsx
import { MarkdownView, mentionPlugin, type Mention } from '@sigx/lynx-markdown';

<MarkdownView
  value="ping @[Andy](u1)"
  plugins={[mentionPlugin]}
  components={{ mention: ({ node }: { node: Mention }) => <text class="chip">@{node.label}</text> }}
/>
```

Link and image URLs are sanitised by the engine before a component sees them (`javascript:` and friends become `#`).

`MarkdownEditor` follows the OS text-size setting: `fontSize` (default 16) is the size at the default system setting, multiplied by the effective font scale — and the auto-grow window (`minLines`/`maxLines`) scales with it, live. Raw `RichTextInput` does not auto-scale; multiply its `fontSize` by `useFontScale()` (from `@sigx/lynx`) if you use it directly.

## License

MIT
