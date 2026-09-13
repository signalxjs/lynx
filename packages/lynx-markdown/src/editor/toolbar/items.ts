/**
 * The toolbar item contract is the core's (`@sigx/richtext/editor`):
 * `ToolbarItem { id, label?, icon?, group?, isActive?(tb), isEnabled?(tb),
 * run(tc) }` over a `ToolbarState` derived from the editor state, and
 * `defaultToolbarItems` — one neutral set every platform shares. Design
 * systems re-skin the rendering (`@sigx/lynx-daisyui`'s `EditorToolbar`);
 * plugins contribute items through their editor slice.
 */

export { defaultToolbarItems, toolbarState } from '@sigx/richtext/editor';
export type { ToolbarItem, ToolbarContext, ToolbarState } from '@sigx/richtext/editor';
