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
   * it can size the scroll track before every cell is measured. Important for
   * accurate scroll-to-index on long lists.
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
  /** Emitted when scrolling reaches the end (bottom / right edge). */
  & Define.Event<'endReached', void>
  /** Emitted when scrolling reaches the start (top / left edge). */
  & Define.Event<'startReached', void>
  /** Emitted on scroll with the current main-axis pixel offset. */
  & Define.Event<'scroll', { offset: number }>;
