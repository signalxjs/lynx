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
- **One continuous sectioned grid (WhatsApp-style)** — the picker is a single
  scroll over *every* category with a sticky header per section: a category
  tab tap **scrolls** to the section (no grid re-mount), and the active tab
  follows as you scroll. Recents (when any exist at mount) are the first
  section, snapshotted per mount so a pick doesn't reorder the grid under
  your thumb; with no recents the tab is hidden too. Theme headers via
  `classes.sectionHeader` (the headless fallback has no background — themes
  should give the sticky header one) and label the recents section with
  `recentsLabel`. Headless `EmojiGrid` users get the same via `sections`
  (plus `sectionRowIndex`/`sectionStartOffsets` for scroll targets and the
  `activeSection` event for a following tab bar); search results still use
  the flat `emojis` mode.
- **Template grid** — a `List` (`@sigx/lynx-list`) in flow layout running
  snapshot-template cells: the full dataset ships as staged row records, the
  main thread builds each cell synchronously the moment the native recycler
  pulls it, and offscreen cells recycle through the template pool — no
  windowing, no per-cell background rendering on scroll. Passing `renderCell`
  swaps in a slot-bearing cell template: still synchronous, but such cells are
  excluded from recycling (each keeps a dedicated tree), so prefer the default
  glyph cell for large grids. A hidden list dispatches scroll events forever,
  so exactly one grid is mounted at a time. Headless `EmojiGrid` users can
  pass `itemsKey` (dataset identity) to re-anchor to the top on a swap, and
  `initialHeight` to lay the grid out at full size on its first frame;
  `EmojiPicker` does both.
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
