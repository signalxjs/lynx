import type { Define, MainThread, MainThreadRef } from '@sigx/lynx';

/** Native `<list>` layout mode. */
export type ListType = 'single' | 'flow' | 'waterfall';

/** Where items snap when paginated scrolling settles. */
export type ListItemSnap = 'start' | 'center' | 'end' | 'none';

/** Alignment target for an imperative scroll-to-index. */
export type ScrollAlign = 'top' | 'bottom' | 'middle';

/**
 * Ref shape consumers pass via `mtRef` to capture the underlying native
 * `<list>` element. The current handle is `ref.current` inside a main-thread
 * event handler — pass it through `ListMethods.*` for typed imperative scroll.
 */
export type ListRef = MainThreadRef<MainThread.Element | null>;

/**
 * Props for {@link List} — a data-driven wrapper over the native `<list>`
 * recycler. Generic over the item type `T`.
 */
export type ListProps<T = unknown> =
  /** The data to render — one cell per item. */
  & Define.Prop<'items', readonly T[], true>
  /** Per-item renderer. Output is wrapped in a recycled `<list-item>`. */
  & Define.Prop<'renderItem', (item: T, index: number) => unknown, true>
  /**
   * Stable unique key per item for the native recycler (`item-key`).
   * Defaults to the array index — **provide a real key** for any list whose
   * items can move/insert/delete, or recycling will reuse the wrong cell.
   */
  & Define.Prop<'keyExtractor', (item: T, index: number) => string, false>
  /**
   * Recycle-pool selector (`item-type`). Cells with the same type share a
   * view pool. Defaults to a single shared pool — set this when rows have
   * structurally different layouts so each kind recycles against its own.
   */
  & Define.Prop<'itemType', (item: T, index: number) => string, false>
  /**
   * Estimated main-axis size (height when vertical, width when horizontal)
   * of a cell in px, fed to the recycler as `estimated-main-axis-size-px` so
   * it can size the scroll track before every cell is measured. Useful for long
   * lists of **uniform** rows.
   *
   * **Omit it for variable-height content (e.g. chat bubbles).** Native draws a
   * not-yet-measured cell at this placeholder height until it measures the real
   * content, so a value smaller than an item briefly clips it (most visible as a
   * new message scrolls into view). With no estimate, cells self-measure and
   * never clip — at the cost of a less precise scroll track, which is
   * unnoticeable for a bounded/windowed list.
   */
  & Define.Prop<'estimatedItemSize', number, false>
  /** Scroll horizontally instead of vertically (`scroll-orientation`). */
  & Define.Prop<'horizontal', boolean, false>
  /** Columns (vertical) / rows (horizontal) for grid layouts (`span-count`). */
  & Define.Prop<'numColumns', number, false>
  /** Layout mode: `single` (default), `flow` (grid), `waterfall`. */
  & Define.Prop<'listType', ListType, false>
  /** Snap items to an edge during paginated scroll (`item-snap`). */
  & Define.Prop<'itemSnap', ListItemSnap, false>
  /**
   * Enable sticky positioning for items carrying `sticky-top`/`sticky-bottom`
   * (native `sticky` attr) — section headers in a sectioned list. In
   * `templateCells` mode set the per-item sticky attrs directly on the
   * `<list-item>` template.
   */
  & Define.Prop<'sticky', boolean, false>
  /** Pixel offset sticky items pin at (native `sticky-offset`). Default 0. */
  & Define.Prop<'stickyOffset', number, false>
  /**
   * Fire `endReached` when this many items remain below the viewport
   * (`lower-threshold-item-count`). Defaults to the native default.
   */
  & Define.Prop<'onEndReachedThreshold', number, false>
  /**
   * Fire `startReached` when this many items remain above the viewport
   * (`upper-threshold-item-count`). Defaults to the native default.
   */
  & Define.Prop<'onStartReachedThreshold', number, false>
  /** Throttle interval (ms) for the `scroll` event (`scroll-event-throttle`). */
  & Define.Prop<'scrollEventThrottle', number, false>
  /**
   * Controlled pull-to-refresh state. **Passing this prop (even `false`) opts
   * the list into pull-to-refresh**: pulling down past `pullThreshold` while
   * scrolled to the top emits `refresh`; keep the indicator open by holding
   * `refreshing` true, then set it back to `false` to dismiss. Omit the prop
   * entirely to disable pull-to-refresh (zero gesture overhead). Vertical lists
   * only — a `horizontal` list ignores it (there is no pull-down-from-top).
   */
  & Define.Prop<'refreshing', boolean, false>
  /** Pull distance in px that triggers a refresh (and the indicator height). Default 64. */
  & Define.Prop<'pullThreshold', number, false>
  /**
   * Show a loading indicator cell at the end of the list (for infinite
   * load-more, paired with `onEndReached`). Uses the `footer` slot content
   * when provided, else a default row.
   */
  & Define.Prop<'loadingMore', boolean, false>
  /**
   * Chat / bottom-anchored mode. Renders items in natural order (oldest →
   * newest) but first-paints already scrolled to the bottom (the newest
   * message), and — unless `stickToBottom` is `false` — auto-scrolls to the
   * bottom when new items arrive while you're already at the bottom; if you've
   * scrolled up, it surfaces the `newMessages` affordance instead. Vertical
   * lists only. For very long histories pair it with `windowSize` to bound how
   * many cells are rendered at once.
   */
  & Define.Prop<'inverted', boolean, false>
  /**
   * In chat mode (`inverted`), stick to the bottom when new items arrive while
   * already scrolled to the bottom. Default `true`. Set `false` to never
   * auto-scroll (new items always go to the unread affordance when off-screen).
   */
  & Define.Prop<'stickToBottom', boolean, false>
  /**
   * **Enables windowing.** Render only a bounded sliding slice of `items`
   * instead of all of them — essential for very long histories, since the
   * runtime materializes every *rendered* cell (only native views recycle). The
   * window starts at the newest in chat mode (the start in a feed) and pages
   * older/newer as you scroll. This is the number of items rendered initially.
   * Omit to render every item (default). Default when set: 60.
   */
  & Define.Prop<'windowSize', number, false>
  /** Items revealed per scroll-edge page when windowing. Default 30. */
  & Define.Prop<'pageSize', number, false>
  /**
   * **Template-native cells** (#645): `renderItem` returns a `<list-item>`
   * element written in YOUR package/app source (so it compiles to a snapshot
   * template — requires a `snapshots` build, the default), and `List` passes
   * it through **unwrapped**. Rows then exist as cheap staged records: the
   * main thread builds each cell synchronously when the native recycler asks
   * for it (a fling can never observe a blank), offscreen cell trees recycle
   * through template-keyed pools, and **windowing becomes unnecessary** — if
   * `windowSize` is also set, `templateCells` wins (DEV warning).
   *
   * Your `<list-item>` owns `item-key` / `estimated-main-axis-size-px` /
   * `item-type` etc. as JSX attributes (List's `itemType` / `estimatedItemSize`
   * props are not applied to pass-through rows). `keyExtractor` still provides
   * the RECONCILIATION key only (set as the vnode key unless your JSX already
   * carries an explicit `key`) — it does NOT become the native `item-key`,
   * which must come from your `<list-item>` JSX.
   *
   * Rows that are NOT a single compiled `<list-item>` template will render but
   * never pool — and a non-`list-item` root silently fails to paint on native
   * (a main-thread diagnostic — active on hosts exposing __GetTag — names the offending template).
   */
  & Define.Prop<'templateCells', boolean, false>
  /**
   * Hard cap on the rendered window length when windowing — once the window
   * grows past this, the far (off-screen) end is trimmed to stay bounded.
   * Default `max(120, windowSize × 2)`.
   */
  & Define.Prop<'maxWindow', number, false>
  /**
   * Identity of the dataset. When it changes, `items` is treated as a
   * brand-new list rather than an update to the old one: the window (when
   * windowing) re-anchors to its initial position and the scroll resets to
   * the start (the bottom in chat mode). Use it when swapping wholesale
   * between datasets — tabs, categories, a new search — where clamping the
   * old window/scroll would strand the viewport mid-list. Omit for
   * append/prepend/edit flows.
   */
  & Define.Prop<'itemsKey', string, false>
  /**
   * Concrete main-axis size (px) to pin the native `<list>` to on its very
   * first frame, before the measuring wrapper's live measure lands. Without
   * it a freshly mounted list spends its mount frame at a 1px placeholder and
   * visibly re-lays-out once measured. Pass it when the consumer already
   * knows the box size (e.g. sibling lists sharing one container). The live
   * measure still wins as soon as it arrives.
   */
  & Define.Prop<'initialMainAxisSize', number, false>
  /** Capture the native `<list>` element for imperative scrolling. */
  & Define.Prop<'mtRef', ListRef, false>
  /** Class applied to the measuring wrapper that sizes the list. */
  & Define.Prop<'class', string, false>
  /** Style applied to the measuring wrapper (use this for flex sizing). */
  & Define.Prop<'style', Record<string, string | number>, false>
  /** Rendered as a full-span cell before the items. */
  & Define.Slot<'header'>
  /** Rendered as a full-span cell after the items. */
  & Define.Slot<'footer'>
  /** Rendered in place of the list when `items` is empty. */
  & Define.Slot<'empty'>
  /**
   * Custom pull-to-refresh indicator, shown in the area revealed by the pull.
   * Defaults to a simple "Refreshing…" row. Requires the `refreshing` prop.
   */
  & Define.Slot<'refresh'>
  /**
   * Chat-mode "new messages" affordance, shown floating at the bottom when
   * messages arrive while you're scrolled up. Receives the unread `count`;
   * tapping it scrolls to the bottom and clears the count. Defaults to a
   * simple pill. Requires `inverted`.
   */
  & Define.Slot<'newMessages', { count: number }>
  /** Emitted when scrolling reaches the end (bottom / right edge). */
  & Define.Event<'endReached', void>
  /** Emitted when scrolling reaches the start (top / left edge). */
  & Define.Event<'startReached', void>
  /** Emitted on scroll with the current main-axis pixel offset. */
  & Define.Event<'scroll', { offset: number }>
  /** Emitted when a pull-to-refresh gesture crosses `pullThreshold` and releases. */
  & Define.Event<'refresh', void>;
