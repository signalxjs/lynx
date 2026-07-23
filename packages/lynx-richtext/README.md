# @sigx/lynx-richtext

A **native rich-text input element** for Lynx: `<sigx-richtext>` wraps
`UITextView` (iOS) and `EditText` (Android) with attributed-text editing —
bold is bold *inside* the editable field. It powers `@sigx/lynx-markdown`'s
`MarkdownEditor`, but is markdown-agnostic and usable on its own.

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/richtext/overview/](https://sigx.dev/lynx/modules/richtext/overview/)**

## The document model

A flat, span-based `RichDoc` crosses the bridge — it maps 1:1 onto
`NSAttributedString` / `Spannable` (UTF-16 offsets everywhere, zero index
translation):

```ts
interface RichDoc {
  text: string;                 // flat text, '\n' separates paragraphs
  spans: InlineSpan[];          // {start, end, type: 'bold'|'italic'|'strike'|'code'|'link'|'mention', attrs?}
  blocks: BlockAttr[];          // paragraph ranges: {start, end, type: 'paragraph'|'heading'|…, level?}
  v: number;                    // monotonic version (echo/stale-write protection)
}
```

Native never parses markdown; after every edit it **reads the model back out of
its own text storage** (explicit marker attributes/spans, so a heading's bold
font never reads back as a `bold` span) and emits the full doc.

## Use

```tsx
import { RichTextInput, RichTextMethods, type RichTextHandle } from '@sigx/lynx-richtext';

let el: RichTextHandle = null;

<RichTextInput
  placeholder="Write something…"
  minHeight={40}
  maxHeight={160}
  onElement={(handle) => { el = handle; }}
  onChange={(doc, isComposing) => { /* doc is a decoded RichDoc */ }}
  onSelection={(sel) => { /* sel.activeFormats drives toolbar state */ }}
  onHeightChange={(h) => { /* auto-grow: set the element's style height */ }}
/>;

// Commands are fire-and-forget (BG → MT via the INVOKE_UI_METHOD op);
// state reconciles through the next bindchange/bindselection.
RichTextMethods.toggleFormat(el, 'bold');
RichTextMethods.setBlockType(el, 'heading', 2);
RichTextMethods.insertText(el, '🎉');
```

## IME / echo contract

1. Every user edit bumps the doc version; `bindchange` carries it.
2. `setDocument` with structurally-identical content is a silent no-op.
3. `setDocument` based on a stale version is dropped; current state re-emits.
4. `setDocument` during an active IME composition is dropped (composition
   would be corrupted); `bindchange` flags `isComposing` so callers never echo
   mid-composition.

Prefer the **lightly-controlled** pattern: don't echo keystrokes back — treat
the element as the source of truth for live text and push `setDocument` only
for genuine programmatic mutations (load, clear-on-send, block changes).

## Beyond markdown

The element has **no serialization format of its own** — `RichDoc` is plain
`text + spans + blocks`, and what those *mean* is the consumer's choice.
`@sigx/lynx-markdown`'s `MarkdownEditor` is one consumer (its `mdToDoc` /
`docToMd` converters give the doc markdown semantics), but the same element
backs, for example:

- a styled chat/comment input that stores the **doc JSON directly** (no
  text format at all — render it back with the same spans);
- an editor that serializes to **HTML**, Slack-style mrkdwn, or a custom
  wire format — write the two converters, the rest is identical;
- a plain input that only uses auto-grow + IME-safe programmatic writes,
  ignoring formatting entirely.

The constraint is the **vocabulary**, not the format: v1 ships a fixed set of
span types (`bold` / `italic` / `strike` / `code` / `link` / `mention`) and
block types (`paragraph` / `heading` / … / `raw`). Custom mark types arrive
with the editor plugin API (P3).

## v1 scope

Inline: bold / italic / strike / code / link (render + toggle + typing-edge
inheritance). Blocks: paragraph + headings (1–3 styled; 4–6 fall back to a
smaller scale). Auto-height reporting (`bindheightchange`) with
`min-height`/`max-height` clamping and internal scroll past the ceiling.
Reserved in the model for follow-ups: lists/quote/codeBlock rendering, atomic
mention chips, task checkboxes.

Native code is autolinked by `sigx prebuild` (`signalx-module.json` →
`ios.uiComponents` / `android.behaviors`); run a native rebuild after adding
the package.

## Web

`<sigx-richtext>` also has a **web implementation** — a real `contenteditable`
custom element mirroring the native contract (the same `RichDoc` model, span
formatting, block types, selection + caret-rect events, height reporting, and
version/echo rules), so `RichTextInput` / `MarkdownEditor` work on
`sigx run:web` and `sigx build:web`. `@sigx/lynx-cli` serves it to the host
page automatically when your app depends on this package — no wiring needed.

The web element is shipped separately from the native/BG entry as
`@sigx/lynx-richtext/web-element`: a self-contained, self-registering ESM module
loaded in the host page's document (where `@lynx-js/web-core` creates the
element). It is import-free so it can be served as a plain module without a
bundler.

Web differences from native:

- A collapsed `toggleFormat` is a **no-op** (native flips *typing attributes* so
  the next character inherits the format). Select text first, then toggle —
  the common toolbar flow.
- The soft-keyboard `confirm-type` is advisory on web (there is no on-screen
  return key to relabel).
- `SystemInfo`-derived layout comes from the `<lynx-view>`, not the display
  (see `@sigx/lynx-web-host`).
