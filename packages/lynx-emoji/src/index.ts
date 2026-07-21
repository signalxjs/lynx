// Data
export type { EmojiData, EmojiDatum, EmojiCategory, SkinTone } from './data/schema.js';
export { glyphForTone } from './data/glyph.js';
// Zero-config English dataset. Importing it costs ~240 KB of bundle — apps
// that pass their own locale via `@sigx/lynx-emoji/data/<locale>` and never
// reference this binding tree-shake it away.
export { data as enData } from './data/en.gen.js';

// Search
export { buildSearchIndex, tokenize } from './search/index.js';
export type { EmojiSearchIndex } from './search/index.js';

// State
export { EmojiProvider } from './state/EmojiProvider.js';
export type { EmojiProviderProps } from './state/EmojiProvider.js';
export { createEmojiContext, useEmojiContext } from './state/context.js';
export type { EmojiContextValue, EmojiContextOptions } from './state/context.js';
export type { RecentsStore } from './state/recents.js';
export type { SkinToneStore } from './state/skinTone.js';

// Components
export { EmojiPicker } from './components/EmojiPicker.js';
export type { EmojiPickerProps } from './components/EmojiPicker.js';
export { createStagingDriver, EmojiGrid, sectionRowIndex, sectionStartOffsets } from './components/EmojiGrid.js';
export type { EmojiGridProps, EmojiGridScrollHandle, EmojiSection } from './components/EmojiGrid.js';
export { SectionHeader, HEADER_PX } from './components/SectionHeader.js';
export type { SectionHeaderProps } from './components/SectionHeader.js';
export { emojiRowPx } from './components/EmojiCell.js';
export { EmojiCell } from './components/EmojiCell.js';
export type { EmojiCellProps } from './components/EmojiCell.js';
export { CategoryTabBar } from './components/CategoryTabBar.js';
export type { CategoryTabBarProps, CategoryTabEntry } from './components/CategoryTabBar.js';
export { SearchInput } from './components/SearchInput.js';
export type { SearchInputProps } from './components/SearchInput.js';
export { SkinTonePopover } from './components/SkinTonePopover.js';
export type { SkinTonePopoverProps } from './components/SkinTonePopover.js';

// Wrappers
export { KeyboardPanelPicker } from './wrappers/KeyboardPanelPicker.js';
export type { KeyboardPanelPickerProps } from './wrappers/KeyboardPanelPicker.js';
export { useKeyboardPanelReveal } from './wrappers/useKeyboardPanelReveal.js';
export type {
    KeyboardPanelReveal,
    KeyboardPanelRevealOptions,
    PanelRevealMode,
} from './wrappers/useKeyboardPanelReveal.js';
export { SheetPicker } from './wrappers/SheetPicker.js';
export type { SheetPickerProps } from './wrappers/SheetPicker.js';

// Shared types (incl. the EmojiPropsExtensions theme augmentation point)
export type {
    EmojiPickEvent,
    EmojiPropsExtensions,
    EmojiRenderCategoryTab,
    EmojiRenderCell,
    EmojiRenderSearchInput,
    EmojiSearchApi,
    EmojiSlotClasses,
    EmojiTab,
} from './types.js';
