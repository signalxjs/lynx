/**
 * daisyUI skin for `@sigx/lynx-emoji` (optional peer) — the same pattern as
 * the markdown toolbar skin: the generic package stays headless, this module
 * supplies the class literals (scanned from daisyui by the app's Tailwind
 * `content` glob) and themed render props.
 */

import type { EmojiSlotClasses } from '@sigx/lynx-emoji';

/** Slot → daisy/Tailwind classes — pass to any picker's `classes` prop. */
export const emojiClasses: EmojiSlotClasses = {
    root: 'bg-base-100',
    searchWrap: 'px-3 pt-3 pb-2',
    search: 'input input-sm input-bordered w-full',
    tabBar: 'px-2 pb-1 border-b border-base-300',
    tab: 'rounded-lg',
    tabActive: 'bg-base-300',
    // Sticky section headers need an opaque background. Height is pinned by
    // the component itself (HEADER_PX — the scroll-offset math depends on it).
    sectionHeader: 'bg-base-100 px-3 flex items-center',
    popover: 'bg-base-100 border border-base-300 rounded-xl shadow-lg px-1 py-1',
    popoverCell: 'rounded-lg',
    empty: 'opacity-60',
};

/**
 * The same skin for `tabPlacement="bottom"` (the WhatsApp arrangement).
 * A bottom tab row needs the divider on its TOP edge, and — because a
 * bottom bar pinned to a sheet's visible edge paints OVER the grid rows it
 * overlaps — an opaque background of its own.
 *
 * A module-level constant, not a spread at the call site: `classes` must
 * keep a stable identity or every picker render re-runs the grid.
 */
export const emojiClassesBottomTabs: EmojiSlotClasses = {
    ...emojiClasses,
    tabBar: 'bg-base-100 px-2 py-1 border-t border-base-300',
};
