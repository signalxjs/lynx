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
// offset, smooth })`. TODO(device-verify): confirm name/params on iOS+Android
// (the runtime also references `scrollToIndex` in mt-element.ts).
const SCROLL_METHOD = 'scrollToPosition';

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
  /** Scroll so the cell at `index` aligns per `opts.align` (default `top`). */
  scrollToIndex(
    el: MainThread.Element | null,
    index: number,
    opts: ScrollToIndexOptions = {},
  ): void {
    invokeScroll(el, index, opts);
  },
  /** Scroll to the first cell. */
  scrollToTop(el: MainThread.Element | null, opts: { smooth?: boolean } = {}): void {
    invokeScroll(el, 0, { align: 'top', smooth: opts.smooth });
  },
  /**
   * Scroll to the last cell (aligned to the bottom/right edge). Pass the
   * current `items.length` so it can target the final index.
   */
  scrollToEnd(
    el: MainThread.Element | null,
    itemCount: number,
    opts: { smooth?: boolean } = {},
  ): void {
    if (itemCount <= 0) return;
    invokeScroll(el, itemCount - 1, { align: 'bottom', smooth: opts.smooth });
  },
} as const;
