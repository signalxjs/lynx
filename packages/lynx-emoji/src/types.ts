import type { JSXElement } from '@sigx/lynx';
import type { EmojiCategory, EmojiDatum, SkinTone } from './data/schema.js';

/** What a pick surfaces: the entry, the tone-resolved glyph, the tone used. */
export interface EmojiPickEvent {
    datum: EmojiDatum;
    /** The string to insert — `datum.e` or the active skin-tone variant. */
    glyph: string;
    tone: SkinTone;
}

/** Replace a grid cell's content (rendered inside the cell's Pressable). */
export type EmojiRenderCell = (datum: EmojiDatum, glyph: string) => JSXElement;

/** The synthetic recents tab uses `'recents'` in place of a category. */
export type EmojiTab = EmojiCategory | 'recents';

/** Replace a category tab's content (rendered inside the tab's Pressable). */
export type EmojiRenderCategoryTab = (tab: EmojiTab, glyph: string, active: boolean) => JSXElement;

/** What a custom search field needs to drive the picker. */
export interface EmojiSearchApi {
    /** Reactive — call inside render to subscribe. */
    query(): string;
    setQuery(query: string): void;
}

/** Replace the whole search row. */
export type EmojiRenderSearchInput = (api: EmojiSearchApi) => JSXElement;

/**
 * Per-slot class overrides — the theming surface. The components are
 * headless (neutral inline fallbacks only); a theme passes utility classes
 * per slot, e.g. daisyui's `emojiClasses`.
 */
export interface EmojiSlotClasses {
    /** Picker root column. */
    root?: string;
    /** Search row wrapper. */
    searchWrap?: string;
    /** The search `<input>` itself. */
    search?: string;
    /** Category tab bar row. */
    tabBar?: string;
    /** One category tab. */
    tab?: string;
    /** Extra classes for the active tab. */
    tabActive?: string;
    /** The grid `<list>`. */
    grid?: string;
    /** One emoji cell. */
    cell?: string;
    /** The empty-state row (no recents / no search hits). */
    empty?: string;
    /** Skin-tone popover backdrop. */
    popoverBackdrop?: string;
    /** Skin-tone popover surface. */
    popover?: string;
    /** One variant cell inside the popover. */
    popoverCell?: string;
}

/**
 * Theme augmentation point (the `IconPropsExtensions` pattern from
 * lynx-icons): a theme package can `declare module '@sigx/lynx-emoji'` and
 * extend this interface to add its own props to `EmojiPickerProps`.
 */
export interface EmojiPropsExtensions {}
