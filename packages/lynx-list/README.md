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
lands). This mirrors the pattern proven by `EmojiGrid` in `@sigx/lynx-emoji`.

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
is present.

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

```tsx
<List
  items={messages.value}
  keyExtractor={(m) => m.id}
  estimatedItemSize={56}
  inverted
  style={{ flexGrow: 1 }}
  renderItem={(m) => <MessageBubble message={m} />}
  slots={{ newMessages: ({ count }) => <Pill>{count} new ↓</Pill> }}
/>
```

## Props

| Prop | Type | Notes |
|---|---|---|
| `items` | `readonly T[]` | **Required.** The data. |
| `renderItem` | `(item: T, index) => JSX` | **Required.** Per-cell renderer. |
| `keyExtractor` | `(item: T, index) => string` | Stable recycler key (`item-key`). Defaults to the index — set it for lists that mutate. |
| `itemType` | `(item: T, index) => string` | Recycle-pool selector (`item-type`). |
| `estimatedItemSize` | `number` | Main-axis px estimate; improves scroll accuracy. |
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
| `mtRef` | `ListRef` | Capture the native element for `ListMethods`. |
| `class` / `style` | — | Applied to the measuring wrapper. |

**Events:** `onEndReached`, `onStartReached`, `onScroll({ offset })`, `onRefresh`.
**Slots:** `header`, `footer`, `empty`, `refresh`, `newMessages({ count })`.

## Roadmap

- **Windowing** for WhatsApp-scale message histories (load-older-on-scroll-up
  with prepend anchoring).
- **Lazy runtime virtualization** so off-screen cells aren't eagerly built.

## License

MIT
