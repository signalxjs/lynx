# @sigx/lynx-markdown

A **SignalX-native, streaming-aware markdown renderer** for Lynx.

It parses markdown in JavaScript (zero dependencies) and renders to native Lynx
`<view>`/`<text>`/`<image>` primitives — so it renders **identically on every
platform** (iOS, Android, Harmony) and is fully controllable from JS. Built for
AI output: as the source string grows token-by-token, finalized blocks keep a
stable identity and are never re-parsed or remounted, so completed content
doesn't flicker or reflow while new tokens stream in.

## Install

```
pnpm add @sigx/lynx-markdown
```

## Use

```tsx
import { MarkdownView } from '@sigx/lynx-markdown';

export default function ArticleScreen() {
  return (
    <MarkdownView
      value={'# Hello\n\nThis is **markdown** with a [link](https://signalx.dev).'}
      onLink={(href) => openUrl(href)}
    />
  );
}
```

### Streaming AI output

`createMarkdownStream()` bridges a token loop to `<MarkdownView>` in one line. It
owns a reactive `value` signal and coalesces bursts of tokens into a bounded
number of re-renders.

```tsx
import { MarkdownView, createMarkdownStream } from '@sigx/lynx-markdown';

const md = createMarkdownStream({ flushIntervalMs: 16 }); // ~60fps cap

// producer — your AI completion loop
for await (const token of completion) md.append(token);
md.done();

// consumer
<MarkdownView value={md.value.value} />;
```

`MarkdownStream` API:

| Member             | Description                                              |
| ------------------ | ------------------------------------------------------- |
| `value`            | Reactive accumulated source (`PrimitiveSignal<string>`).|
| `finished`         | Reactive flag, set by `done()`.                         |
| `append(chunk)`    | Append a token/chunk; buffered + coalesced into `value`.|
| `done()`           | Flush the buffer and mark complete.                     |
| `reset()`          | Clear buffer/`value`/`finished` (e.g. for a regenerate).|

## Supported syntax

Core CommonMark + GFM:

- Headings (`#`…`######`)
- Paragraphs with soft-wrap joining
- **Bold**, _italic_, ~~strikethrough~~, `inline code`
- Links, images, angle (`<url>`) and bare (`https://…`, `www.…`) autolinks
- Ordered and unordered nested lists, GFM task lists (`- [ ]` / `- [x]`)
- Blockquotes (with nested blocks)
- Fenced code blocks (with language label); unterminated fences render while
  streaming and close cleanly when the final fence arrives
- Thematic breaks (`---`, `***`, `___`)
- GFM tables with per-column alignment

Not supported (renders as literal text): raw HTML, reference-style links,
setext headings, syntax highlighting. Link hrefs are sanitized — only
`http(s):`, `mailto:`, `tel:` and scheme-less links are exposed to `onLink`;
`javascript:`/`data:` collapse to `#`.

### `<MarkdownView>` props

| Prop          | Type                          | Description                                  |
| ------------- | ----------------------------- | -------------------------------------------- |
| `value`       | `string`                      | Markdown source (reactive).                  |
| `onLink`      | `(href: string) => void`      | Fired when a link/autolink is tapped.        |
| `onImageTap`  | `(src: string) => void`       | Fired when an image is tapped.               |
| `components`  | `Partial<MarkdownComponents>` | Per-node-type render-function overrides.     |

### Theming with `components`

`MarkdownView` is **design-system agnostic**: it ships neutral, theme-agnostic
defaults and walks the AST calling a render function per node type. Override any
subset to control the element, styling, and layout — the engine pre-renders each
node's `children` and keeps the stable streaming keys regardless of what you
return.

```tsx
<MarkdownView
  value={src}
  components={{
    heading: ({ level, children }) => <Heading level={level}>{children}</Heading>,
    strong: ({ children }) => <text class="font-bold">{children}</text>,
  }}
/>
```

For a ready-made daisyUI mapping, pass `markdownComponents` from
`@sigx/lynx-daisyui`:

```tsx
import { MarkdownView } from '@sigx/lynx-markdown';
import { markdownComponents } from '@sigx/lynx-daisyui';

<MarkdownView value={src} components={markdownComponents} />;
```

