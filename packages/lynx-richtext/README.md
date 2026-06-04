# @sigx/lynx-richtext

A **native rich-text input element** for Lynx: `<sigx-richtext>` wraps
`UITextView` (iOS) and `EditText` (Android) with attributed-text editing —
bold is bold *inside* the editable field. It powers `@sigx/lynx-markdown`'s
`MarkdownEditor`, but is markdown-agnostic and usable on its own.

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
