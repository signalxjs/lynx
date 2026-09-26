// @sigx/lynx-daisyui/emoji — daisyUI skin + themed sheet for the optional
// `@sigx/lynx-emoji` peer (`EmojiPickerSheet` also needs `@sigx/lynx-sheet`).
// Kept OFF the root barrel so importing `@sigx/lynx-daisyui` never forces
// either to resolve. Apps using these install the peers and import from this
// subpath:
//
//   import { EmojiPickerSheet, emojiClasses } from '@sigx/lynx-daisyui/emoji';
export { emojiClasses, emojiClassesBottomTabs } from './emoji/components.js';
export { EmojiPickerSheet } from './emoji/EmojiPickerSheet.js';
export type { EmojiPickerSheetProps } from './emoji/EmojiPickerSheet.js';
