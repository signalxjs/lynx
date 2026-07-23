# @sigx/lynx-markdown

A **SignalX-native, streaming-aware markdown renderer** for Lynx.

It parses markdown in JavaScript (zero dependencies) and renders to native Lynx
`<view>`/`<text>`/`<image>` primitives — so it renders **identically on every
platform** (iOS, Android, Harmony) and is fully controllable from JS. Built for
AI output: as the source string grows token-by-token, finalized blocks keep a
stable identity and are never re-parsed or remounted, so completed content
doesn't flicker or reflow while new tokens stream in.

## 📚 Documentation

Full prop reference, streaming API, theming, the WYSIWYG editor and live examples → **[sigx.dev/lynx/modules/markdown/overview](https://sigx.dev/lynx/modules/markdown/overview/)**

## Install

```bash
pnpm add @sigx/lynx-markdown
```

## A taste

```tsx
import { MarkdownView } from '@sigx/lynx-markdown';

export default function ArticleScreen() {
  return (
    <MarkdownView
      value={'# Hello\n\nThis is **markdown** with a [link](https://sigx.dev).'}
      onLink={(href) => openUrl(href)}
    />
  );
}
```

`createMarkdownStream()` bridges a token loop to `<MarkdownView>` for AI output, coalescing bursts of tokens into a bounded number of re-renders. `MarkdownEditor` adds true-WYSIWYG editing on the native [`@sigx/lynx-richtext`](https://sigx.dev/lynx/modules/richtext/overview/) element, and components are overridable per node type (a ready-made daisyUI mapping ships in [`@sigx/lynx-daisyui`](https://sigx.dev/lynx/modules/daisyui/overview/)). The supported syntax, full prop tables, streaming API, theming and editor/toolbar contracts are documented on the docs site.

`MarkdownEditor` follows the OS text-size setting: `fontSize` (default 16) is the size at the default system setting, multiplied by the effective font scale — and the auto-grow window (`minLines`/`maxLines`) scales with it, live. Raw `RichTextInput` does not auto-scale; multiply its `fontSize` by `useFontScale()` (from `@sigx/lynx`) if you use it directly.

## License

MIT
