# @sigx/lynx-list

High-performance, data-driven **virtualized list** for [sigx-lynx](https://github.com/signalxjs/lynx).

A thin, ergonomic wrapper over Lynx's native `<list>` recycler: pass `items` +
`renderItem` and only the cells on screen ever exist as native views, so it stays
smooth for long feeds and grids. Pure JS — no native module to link.

```sh
pnpm add @sigx/lynx-list
```

## Usage

```tsx
import { List } from '@sigx/lynx-list';

<List
  items={posts}
  keyExtractor={(p) => p.id}
  estimatedItemSize={88}
  style={{ flexGrow: 1 }}
  renderItem={(post) => <PostRow post={post} />}
  onEndReached={() => loadNextPage()}
/>;
```

`items`/`renderItem` are generic — `renderItem`'s argument is inferred from `items`,
so `post` above is fully typed.

### Sizing

The native `<list>` only lays out with a **concrete** main-axis size — `flex`/`%`
resolve to zero and nothing renders. So `class`/`style` land on a measuring
wrapper `<view>` (where flex sizing works as usual, e.g. `style={{ flexGrow: 1 }}`
inside a column); the wrapper measures itself and pins the list to the measured
px. First paint is one frame after mount (a 1px placeholder until the measure
lands) — unless you pass `initialMainAxisSize` with a size you already know
(e.g. sibling lists sharing one container), which pins the list at full size
from its very first frame; the live measure still wins once it arrives. This
mirrors the pattern proven by `EmojiGrid` in `@sigx/lynx-emoji`.

### Grid & waterfall

```tsx
<List items={photos} numColumns={3} listType="flow" renderItem={renderPhoto} />
<List items={cards} numColumns={2} listType="waterfall" renderItem={renderCard} />
```

### Header / footer / empty slots

```tsx
<List
  items={items}
  renderItem={renderRow}
  slots={{
    header: () => <SectionTitle>Recent</SectionTitle>,
    footer: () => <LoadingSpinner />,
    empty: () => <EmptyState />,
  }}
/>
```

`header`/`footer` ride along as full-span cells; `empty` renders in place of the
list when `items` is empty.

### Imperative scrolling

Capture the native element via `mtRef` and drive it from a main-thread handler
with `ListMethods` (mirrors `WebViewMethods` in `@sigx/lynx-webview`):

```tsx
import { useMainThreadRef, type MainThread } from '@sigx/lynx';
import { List, ListMethods } from '@sigx/lynx-list';

const ref = useMainThreadRef<MainThread.Element | null>(null);
const toTop = () => { 'main thread'; ListMethods.scrollToTop(ref.current, { smooth: true }); };

<List mtRef={ref} items={items} renderItem={renderRow} />;
```

`ListMethods.scrollToIndex(el, i, { align, offset, smooth })` and
`scrollToTop(el, { smooth })`. `i` is the **rendered cell index**, not the data
index — a `header` slot is itself cell 0, so add 1 to a data index when a header
is present. Inside a `runOnMainThread` worklet, inline the `el.invoke(...)`
call and pass the exported `SCROLL_METHOD` constant as an argument — worklet
capture doesn't carry imported function refs, so calling `ListMethods.*` there
would silently no-op.

### Inside a bottom sheet (`dragMode="surface"`)

A vertical `<List>` adopts an ancestor `ScrollDragHost` (provided by
`@sigx/lynx-sheet` / `@sigx/lynx-navigation` sheets with `dragMode="surface"`)
automatically — no props needed. The first vertical scrollable inside the
sheet wins the slot: the sheet's pan worklet arbitrates against the list's
live scroll offset (drag down from the top hands the touch back to the
sheet), and the list's scroll is locked while the sheet owns a drag. A
non-adopted vertical List inside a sheet still freezes during sheet drags.

While adopted, a consumer `mtRef` is **mirrored** to the same element rather
than bound: `invoke(...)`-based methods (`ListMethods.*`, `scrollToPosition`)
keep working, but gesture / animated-style attachment to that ref does not.
The scroll-event throttle also tightens to 16 ms (from the default 100) so
the arbitration mirror tracks the finger; an explicit `scrollEventThrottle`
still wins.

### Sticky section headers

Pass `sticky` (and optionally `stickyOffset`, px) on the `List` to activate
sticky positioning for items that declare `sticky-top` / `sticky-bottom`. In
`templateCells` mode set those (plus `full-span` for grid lists) directly on
the header's `<list-item>` template — the platform info flows through with the
template. See `@sigx/lynx-emoji`'s sectioned picker for the full pattern
(headers + scroll-to-section + a tab bar following the scroll).

### Pull-to-refresh & load-more

Opt into pull-to-refresh by passing the controlled `refreshing` prop (vertical
lists only). Pulling down past `pullThreshold` while at the top emits `onRefresh`;
hold `refreshing` true to keep the indicator open, set it back to `false` to
dismiss. Customize the indicator with the `refresh` slot. For infinite scroll,
debounce on `onEndReached` and set `loadingMore` to show a trailing loading cell.

```tsx
<List
  items={items}
  renderItem={renderRow}
  refreshing={refreshing.value}
  onRefresh={() => reload()}
  loadingMore={loadingMore.value}
  onEndReached={() => loadMore()}
/>
```

### Chat mode

Pass `inverted` for a WhatsApp-style chat (vertical only): items render
oldest→newest, the first paint is already scrolled to the newest message
(opacity-gated to hide the jump), and new items **stick to the bottom** while
you're there — or raise the `newMessages` affordance when you've scrolled up
(tap it to jump back down). `stickToBottom` (default `true`) opts out of the
auto-scroll. Provide a real `keyExtractor` so the recycler tracks messages.

Don't pass `estimatedItemSize` for chat — bubbles are variable-height, and a
fixed estimate briefly clips taller messages as they scroll in (see the prop
note below). Let the cells self-measure.

```tsx
<List
  items={messages.value}
  keyExtractor={(m) => m.id}
  inverted
  style={{ flexGrow: 1 }}
  renderItem={(m) => <MessageBubble message={m} />}
  slots={{ newMessages: ({ count }) => <Pill>{count} new ↓</Pill> }}
/>
```

### Windowing (long histories)

For thousands of items, pass `windowSize` to render only a bounded sliding
slice of `items` as native cells (the runtime materializes every *rendered*
cell — only native views recycle). The window anchors to the newest in chat
mode (the start in a feed) and pages older/newer as you scroll, trimming the
off-screen far end to stay within `maxWindow`.

```tsx
<List
  items={allMessages.value}   // the full history in memory…
  keyExtractor={(m) => m.id}
  inverted
  windowSize={60}             // …but only ~60 cells are ever rendered
  pageSize={30}
  style={{ flexGrow: 1 }}
  renderItem={(m) => <MessageBubble message={m} />}
  onStartReached={() => loadOlderFromStore()}  // optional: lazy-page into `items`
/>
```

Scrolling to the top reveals an older page (at-top, so no visible jump); a
zero-jump anchored expansion mid-list is device-pending. Omit `windowSize` to
render every item.

### Swapping datasets (`itemsKey`)

The window and scroll position survive item updates by design — appends,
prepends and edits keep the viewport where it is. But when you replace `items`
**wholesale** (switching tabs or categories, a new search result set), that's
wrong: the viewport stays stranded wherever scrolling had left it in the *old*
dataset. Pass `itemsKey` — an identity for the dataset — and when it changes
the list treats `items` as brand new: the window re-anchors to its initial
position and the scroll resets to the start (the bottom in chat mode).

```tsx
<List
  items={byCategory[activeTab.value]}
  itemsKey={activeTab.value}      // tab switch = a new dataset → back to the top
  keyExtractor={(e) => e.id}
  windowSize={120}
  renderItem={renderCell}
/>
```

Zero-cost when omitted; omit it for append/prepend/edit flows.

## Props

| Prop | Type | Notes |
|---|---|---|
| `items` | `readonly T[]` | **Required.** The data. |
| `renderItem` | `(item: T, index) => JSX` | **Required.** Per-cell renderer. |
| `keyExtractor` | `(item: T, index) => string` | Stable recycler key (`item-key`). Defaults to the index — set it for lists that mutate. |
| `itemType` | `(item: T, index) => string` | Recycle-pool selector (`item-type`). |
| `estimatedItemSize` | `number` | Main-axis px estimate for **uniform** rows; improves scroll accuracy. Omit for variable-height content (chat) — a too-small estimate clips items until measured. |
| `horizontal` | `boolean` | Horizontal scrolling. |
| `numColumns` | `number` | Grid columns (`span-count`). |
| `listType` | `'single' \| 'flow' \| 'waterfall'` | Layout mode. |
| `itemSnap` | `'start' \| 'center' \| 'end' \| 'none'` | Paginated snap. |
| `onEndReachedThreshold` | `number` | Items-from-end to fire `onEndReached`. |
| `onStartReachedThreshold` | `number` | Items-from-start to fire `onStartReached`. |
| `loadingMore` | `boolean` | Show a trailing loading cell (infinite scroll). |
| `refreshing` | `boolean` | Controlled pull-to-refresh state; passing it opts in (vertical only). |
| `pullThreshold` | `number` | Pull distance (px) that triggers a refresh. Default 64. |
| `inverted` | `boolean` | Chat mode: bottom-anchored + stick-to-bottom (vertical only). |
| `stickToBottom` | `boolean` | In chat mode, auto-scroll on new items when at the bottom. Default `true`. |
| `templateCells` | `boolean` | **Template-native rows** — `renderItem` returns a `<list-item>` written in your own source and List passes it through unwrapped. See below. |
| `windowSize` | `number` | Enables windowing: render only this many cells of a long `items`. Ignored under `templateCells`. |
| `pageSize` | `number` | Items revealed per scroll-edge page when windowing. Default 30. |
| `maxWindow` | `number` | Cap on rendered window length; the far end trims past it. Default `max(120, windowSize×2)`. |
| `itemsKey` | `string` | Dataset identity — when it changes, the window re-anchors and scroll resets (see "Swapping datasets"). |
| `initialMainAxisSize` | `number` | Known main-axis px to pin the list to on its first frame (skips the 1px placeholder); the live measure refines it. |
| `mtRef` | `ListRef` | Capture the native element for `ListMethods`. Inside a surface-drag sheet it is mirrored, not bound — `invoke` methods work, gesture/animated-style attachment doesn't. |
| `class` / `style` | — | Applied to the measuring wrapper. |

**Events:** `onEndReached`, `onStartReached`, `onScroll({ offset })`, `onRefresh`.
**Slots:** `header`, `footer`, `empty`, `refresh`, `newMessages({ count })`.

## Template-native cells (`templateCells`)

With `snapshots` builds (the default), JSX written in your app or in a package
built with the snapshot dist emitter compiles to main-thread templates. When
`renderItem` returns a **`<list-item>` element from your own source**, pass
`templateCells` and List stops wrapping it:

```tsx
<List
  items={rows}
  templateCells
  keyExtractor={(r) => r.id}
  renderItem={(r) => (
    <list-item item-key={r.id} estimated-main-axis-size-px={56}>
      <text>{r.title}</text>
    </list-item>
  )}
/>
```

What this changes:

- **Rows are staged records, not rendered subtrees.** The main thread builds
  each cell synchronously the moment the native recycler asks for it — a
  fling can never observe a blank cell — and off-screen cell trees recycle
  through template-keyed pools.
- **Windowing becomes unnecessary** and is disabled (a warning fires if
  `windowSize` is also set). Pass all your items.
- Your `<list-item>` owns `item-key`, `item-type`,
  `estimated-main-axis-size-px`, etc. as JSX attributes; List's `itemType` /
  `estimatedItemSize` props do not apply to pass-through rows. `keyExtractor`
  still supplies the reconciliation key (set as the vnode key unless your JSX
  passes an explicit `key`).
- Keep the cell **self-contained**: a cell whose template has slot children
  (e.g. wrapping a component like `Pressable` around your content) renders
  but never pools. Rows whose root isn't a `<list-item>` don't paint at all —
  a main-thread diagnostic (active on hosts exposing `__GetTag`, one introspection per template type, all builds) names the offending template.

Header, footer, loading and empty slots keep the classic wrapped path; the
two row kinds coexist in one list.

## Roadmap

- ~~Lazy runtime virtualization so off-screen cells aren't eagerly built~~ —
  shipped as `templateCells` (#645, on the #620 snapshot-template runtime).

## License

MIT
