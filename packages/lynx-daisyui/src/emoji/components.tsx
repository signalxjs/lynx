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
    popover: 'bg-base-100 border border-base-300 rounded-xl shadow-lg px-1 py-1',
    popoverCell: 'rounded-lg',
    empty: 'opacity-60',
};
