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
- **Instant, non-blocking mount** — the sectioned grid renders its rows as
  plain template vnodes (no per-row component instance), mounts exactly once
  (gated on the context's `ready` signal — recents/tone stores expose
  `loaded` — and the measured region), and stages the first viewports
  synchronously while the rest streams through `createStagingDriver`'s
  budget-adaptive slices (~a frame of work each, own ops batch per slice), so
  neither thread is ever blocked past a frame while ~2k rows load. The driver
  is exported for warm pre-staging (e.g. behind a keyboard panel). Tab taps
  during the brief staging tail are never dropped: pass `scrollHandle` from
  `EmojiGrid` (the picker wires it internally) and scrolls to not-yet-staged
  sections park and fire the moment their rows land — latest tap wins, a
  manual scroll cancels.
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
- **Screen-adaptive, WhatsApp-dense geometry** — the picker fits as many
  ~40px cells as the measured width allows (that's the default column count:
  10 on a typical phone, clamped 7–12), then sizes the glyph so its VISIBLE
  INK covers ~93% of the cell: emoji fonts ink only ~64% of their declared
  size, so the font overshoots the cell (clamped 24–72) and row heights
  track the ink, not the em box. Device-matched against WhatsApp. Category
  tabs and the skin-tone popover scale along. Resolved once at mount; pass
  `columns` and/or `cellSize` for manual control.
- **Search** — ranked shortcode/name/keyword search (`useEmojiSearch`-free:
  `buildSearchIndex(data).search('fire')`).
- **Skin tones** — long-press a tonal emoji; the choice is sticky grid-wide
  and persists.
- **Recents** — LRU, persisted via `@sigx/lynx-storage` (optional peer;
  without it everything works, state just resets per session).
- **Wrappers** — `KeyboardPanelPicker` (keyboard-height composer panel — the
  WhatsApp keyboard ⇄ panel switcher; pass `warm` to pre-mount the picker
  offscreen so the first open is an instant style swap, and once opened it
  stays mounted across toggles; the painted height is frozen while open and
  adopts the keyboard's newest height when parked; `expandedHeight` paints
  the open panel taller for a two-stage picker — WhatsApp's drag-up-for-more
  — while the compact detent stays exactly the remembered keyboard lift, so
  the keyboard ⇄ panel swap is still pixel-stable) with
  `useKeyboardPanelReveal` (the reveal state machine: the app animates
  nothing — the panel paints pinned in the keyboard's space and the system
  keyboard's own show/hide does all visible motion, including a
  tween-settled space handoff on flip-back so the composer bar never moves)
  and `SheetPicker` (bottom-sheet overlay).
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
