# @sigx/lynx-emoji

Themable emoji picker for sigx-lynx. Pure JS — no native module: iOS has no
system emoji-picker component and Android's is frozen in alpha, so (like
every major chat app) the picker is rendered in-framework, backed by a
compact dataset generated from [emojibase](https://emojibase.dev) (MIT,
Unicode 17).

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/emoji/overview/](https://sigx.dev/lynx/modules/emoji/overview/)**

- **Headless components** — `EmojiPicker` (search + category tabs + grid +
  skin-tone popover), or compose `EmojiGrid` / `SearchInput` /
  `CategoryTabBar` / `SkinTonePopover` yourself. Theme via the
  `classes` slot map and render props; `@sigx/lynx-daisyui` ships a skin
  (`emojiClasses`, `EmojiPickerSheet`).
- **Windowed grid** — a windowed `List` (`@sigx/lynx-list`) in flow layout:
  the native recycler keeps the on-screen view count constant while
  scrolling, and windowing bounds how many cells are ever *built* — so
  switching to a big category constructs ~120 cells instead of up to ~388.
  Headless `EmojiGrid` users can pass `itemsKey` (a dataset identity string)
  to re-anchor the grid to the top when handing it a different dataset;
  `EmojiPicker` does this automatically on tab switches and search-query
  changes.
- **Search** — ranked shortcode/name/keyword search (`useEmojiSearch`-free:
  `buildSearchIndex(data).search('fire')`).
- **Skin tones** — long-press a tonal emoji; the choice is sticky grid-wide
  and persists.
- **Recents** — LRU, persisted via `@sigx/lynx-storage` (optional peer;
  without it everything works, state just resets per session).
- **Wrappers** — `KeyboardPanelPicker` (keyboard-height composer panel) and
  `SheetPicker` (bottom-sheet overlay).
- **Markdown plugin** — `@sigx/lynx-emoji/markdown` exports
  `createEmojiPlugin()` for `@sigx/lynx-markdown`'s editor (optional peer):
  `:` trigger suggestions (inserts the glyph), `:shortcode:` preview syntax,
  optional toolbar 😊 hook.

## Usage

```tsx
import { EmojiPicker, enData } from '@sigx/lynx-emoji';

<EmojiPicker
    data={enData}
    onPick={({ glyph }) => insert(glyph)}
/>
```

Share recents/skin tone across surfaces with a provider:

```tsx
import { EmojiProvider, enData } from '@sigx/lynx-emoji';

<EmojiProvider data={enData}>
    {/* any picker below needs no data prop */}
</EmojiProvider>
```

Editor integration:

```tsx
import { createEmojiPlugin } from '@sigx/lynx-emoji/markdown';

const emoji = createEmojiPlugin({ onPickerRequest: () => openSheet() });
<MarkdownEditor plugins={[emoji]} toolbar />
```

daisyUI skin:

```tsx
import { EmojiPickerSheet, emojiClasses } from '@sigx/lynx-daisyui';

<EmojiPicker data={enData} classes={emojiClasses} onPick={…} />
<EmojiPickerSheet open={open.value} data={enData} onPick={…} onClose={…} />
```

## Locale data

`@sigx/lynx-emoji/data/en` ships generated from `emojibase-data` (a
devDependency — raw datasets never ship). To add a locale, append it to
`LOCALES` in `scripts/gen-data.mjs`, run `pnpm -F @sigx/lynx-emoji gen:data`,
add the subpath to `exports`, and commit the generated file. `enData` is
re-exported from the root for zero-config use and tree-shakes away when you
import a specific locale instead.
