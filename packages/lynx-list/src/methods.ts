import type { MainThread } from '@sigx/lynx';
import type { ScrollAlign } from './types.js';

/** Options for an imperative scroll-to-index. */
export interface ScrollToIndexOptions {
  /** Align the target cell to the `top` (default), `bottom`, or `middle`. */
  align?: ScrollAlign;
  /** Extra pixel offset applied after alignment. */
  offset?: number;
  /** Animate the scroll. Defaults to `false` (jump). */
  smooth?: boolean;
}

// `invoke()` rejects when the native UI method errors or the element is stale.
// The scroll wrappers are fire-and-forget, so swallow the rejection — callers
// shouldn't have to wrap every handler in try/catch or accumulate unhandled
// rejection warnings.
function fireAndForget(p: Promise<unknown> | undefined): void {
  p?.catch(() => { /* documented no-op semantics */ });
}

// The native `<list>` scroll UI-method name + param shape. Centralized here so
// it's a one-line change if device verification turns up a different contract.
// Per the Lynx `<list>` docs this is `scrollToPosition({ position, alignTo,
// offset, smooth })`. Device-verified on iOS (sim, Lynx 3.x): the emoji picker's
// `itemsKey` swap visibly resets a deep-scrolled grid to the top through this
// exact invoke. TODO(device-verify): still unconfirmed on Android.
// Exported so chat mode's scroll-to-bottom worklets share the single source of
// truth (and the one device-verification point).
export const SCROLL_METHOD = 'scrollToPosition';

function invokeScroll(
  el: MainThread.Element | null,
  index: number,
  opts: ScrollToIndexOptions,
): void {
  fireAndForget(el?.invoke(SCROLL_METHOD, {
    position: index,
    alignTo: opts.align ?? 'top',
    offset: opts.offset ?? 0,
    smooth: opts.smooth ?? false,
  }));
}

/**
 * Typed wrappers around the native `<list>` scroll UI methods, callable from
 * any main-thread event handler. Mirrors `WebViewMethods` in `@sigx/lynx-webview`.
 *
 * All methods accept `el | null` so call sites can pass `ref.current` directly;
 * a null element is a silent no-op.
 *
 * **Indices are rendered-cell indices, not data indices.** A `header` slot is
 * itself the first cell (index 0), so when a header is present a data item at
 * data-index `i` lives at cell index `i + 1`. `scrollToTop` is unaffected (the
 * header *is* the top). A header-aware scroll-to-bottom that accounts for the
 * footer cell ships with chat mode, where the list owns the cell layout.
 *
 * @example
 * ```tsx
 * import { useMainThreadRef, type MainThread } from '@sigx/lynx';
 * import { List, ListMethods } from '@sigx/lynx-list';
 *
 * const ref = useMainThreadRef<MainThread.Element | null>(null);
 * const toTop = () => { 'main thread'; ListMethods.scrollToTop(ref.current, { smooth: true }); };
 *
 * <List mtRef={ref} items={items} renderItem={renderRow} />
 * ```
 */
export const ListMethods = {
  /**
   * Scroll so the rendered cell at `index` aligns per `opts.align` (default
   * `top`). `index` is the cell index — add 1 to a data index when a `header`
   * slot is present (see the note above).
   */
  scrollToIndex(
    el: MainThread.Element | null,
    index: number,
    opts: ScrollToIndexOptions = {},
  ): void {
    invokeScroll(el, index, opts);
  },
  /** Scroll to the first cell (the top of the list, header included). */
  scrollToTop(el: MainThread.Element | null, opts: { smooth?: boolean } = {}): void {
    invokeScroll(el, 0, { align: 'top', smooth: opts.smooth });
  },
} as const;
