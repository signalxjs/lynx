/**
 * Pure window-math for the bounded sliding window `@sigx/lynx-list` uses to keep
 * very long histories from materializing thousands of `<list-item>` shadow
 * elements (the runtime renders every rendered cell eagerly — only native
 * *views* recycle). With windowing on, the List renders just
 * `items.slice(window.start, window.end)`; these helpers move that window as the
 * user scrolls, keeping its length within `maxWindow`.
 *
 * Kept side-effect-free so the math is unit-testable in isolation.
 */

/** A half-open range of item indices `[start, end)` rendered by the list. */
export interface ListWindow {
  /** First item index in the rendered window (inclusive). */
  start: number;
  /** One past the last item index in the rendered window (exclusive). */
  end: number;
}

/** Resolved windowing knobs (after defaults). */
export interface WindowConfig {
  /** Items rendered initially / the target window length. */
  windowSize: number;
  /** Items revealed per scroll-edge page. */
  pageSize: number;
  /** Hard cap on rendered window length — trimming the far end keeps it here. */
  maxWindow: number;
}

/** Resolve the window props to a config, applying defaults and sane bounds. */
export function resolveWindowConfig(
  windowSize: number | undefined,
  pageSize: number | undefined,
  maxWindow: number | undefined,
): WindowConfig {
  const ws = windowSize && windowSize > 0 ? Math.floor(windowSize) : 60;
  const ps = pageSize && pageSize > 0 ? Math.floor(pageSize) : 30;
  // maxWindow must be ≥ windowSize, else the window can never hold its target.
  const mwRaw = maxWindow && maxWindow > 0 ? Math.floor(maxWindow) : Math.max(120, ws * 2);
  return { windowSize: ws, pageSize: ps, maxWindow: Math.max(mwRaw, ws) };
}

/**
 * Initial window over `len` items. Chat anchors to the newest (window ends at
 * `len`); a feed anchors to the start.
 */
export function initialWindow(len: number, cfg: WindowConfig, chat: boolean): ListWindow {
  if (len <= 0) return { start: 0, end: 0 };
  if (chat) {
    const end = len;
    return { start: Math.max(0, end - cfg.windowSize), end };
  }
  return { start: 0, end: Math.min(len, cfg.windowSize) };
}

/**
 * Grow the window toward older items (scroll-up / load-older). Lowers `start`
 * by `pageSize`; if that pushes the window past `maxWindow`, trims the newest
 * tail (lowers `end`) — those cells sit far below a scrolled-to-top viewport, so
 * dropping them never disturbs what's on screen. Never trims below `windowSize`
 * of content.
 */
export function expandOlder(win: ListWindow, cfg: WindowConfig): ListWindow {
  const start = Math.max(0, win.start - cfg.pageSize);
  let end = win.end;
  // Clamp the newest tail fully to maxWindow (those cells are far below a
  // scrolled-to-top viewport, so trimming them never disturbs the screen).
  if (end - start > cfg.maxWindow) end = start + cfg.maxWindow;
  return { start, end };
}

/**
 * Grow the window toward newer items (scroll-down). Raises `end` by `pageSize`
 * (clamped to `len`); trims the oldest head past `maxWindow` (off-screen above).
 */
export function expandNewer(win: ListWindow, len: number, cfg: WindowConfig): ListWindow {
  const end = Math.min(len, win.end + cfg.pageSize);
  let start = win.start;
  // Clamp the oldest head fully to maxWindow (off-screen above the viewport).
  if (end - start > cfg.maxWindow) start = Math.max(0, end - cfg.maxWindow);
  return { start, end };
}

/**
 * New items appended at the end (length grew) while anchored to the bottom:
 * keep the newest rendered and bound the window to `maxWindow`.
 */
export function slideToEnd(win: ListWindow, len: number, cfg: WindowConfig): ListWindow {
  const end = len;
  return { start: Math.max(0, Math.max(win.start, end - cfg.maxWindow)), end };
}

/** Keep a window valid against the current item count (clamp drift / shrink). */
export function clampWindow(win: ListWindow, len: number): ListWindow {
  const end = Math.max(0, Math.min(win.end, len));
  return { start: Math.max(0, Math.min(win.start, end)), end };
}

/** How `items` changed since the window was last moved. */
export interface ItemsChange {
  /** New `items.length`. */
  len: number;
  /** Previous `items.length`. */
  prevLen: number;
  /** `itemsKey` changed → a brand-new dataset, not an edit of the old one. */
  swapped: boolean;
  /** Chat / bottom-anchored mode. */
  chat: boolean;
  /** Chat is sticking to the bottom (stickToBottom on and viewport at bottom). */
  anchoredAtEnd: boolean;
}

/**
 * Window transition for an items/itemsKey change (swap > append > clamp): a
 * swap re-anchors to the initial window; a chat append while anchored at the
 * bottom slides to the newest; anything else just clamps into range.
 */
export function windowAfterItemsChange(
  cur: ListWindow,
  c: ItemsChange,
  cfg: WindowConfig,
): ListWindow {
  if (c.swapped) return initialWindow(c.len, cfg, c.chat);
  if (c.len === c.prevLen) return cur;
  if (c.len > c.prevLen && c.chat && c.anchoredAtEnd) return slideToEnd(cur, c.len, cfg);
  return clampWindow(cur, c.len);
}
