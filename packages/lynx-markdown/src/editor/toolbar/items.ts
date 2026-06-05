/**
 * The toolbar item contract — the editor analogue of the renderer's
 * `MarkdownComponents` map. A toolbar is just an array of these; design
 * systems re-skin the *rendering* (see `@sigx/lynx-daisyui`'s
 * `EditorToolbar`) while the items stay shared, and P3 plugins contribute
 * additional items through the same shape.
 */

import type { SelectionState } from '@sigx/lynx-richtext';
import type { MarkdownEditorController } from '../MarkdownEditor.js';

/** What an item's `run` receives — the editor's imperative surface. */
export interface ToolbarContext {
    controller: MarkdownEditorController;
}

export interface ToolbarItem {
    /** Stable identifier (also the default `key`). */
    id: string;
    /**
     * Short text rendering (`B`, `H1`, …). The neutral toolbar renders this
     * (falling back to `id` when omitted); skins may render `icon` instead.
     * Optional so icon-only items/skins don't need a dummy label.
     */
    label?: string;
    /** Optional icon hint for skins (e.g. an icon-set name). Never required. */
    icon?: string;
    /** Items with the same group render adjacent (skins may add separators). */
    group?: string;
    /** Highlighted state, derived from the last selection event. */
    isActive?(sel: SelectionState | null): boolean;
    run(ctx: ToolbarContext): void;
}

const formatActive = (format: string) =>
    (sel: SelectionState | null): boolean =>
        !!sel && (sel.activeFormats as readonly string[]).includes(format);

const headingActive = (level: number) =>
    (sel: SelectionState | null): boolean =>
        sel?.activeBlock === 'heading' && sel.headingLevel === level;

/**
 * The neutral default item set: every command the v1 controller exposes.
 * (Lists / quote / link items arrive with the block-WYSIWYG work — #153.)
 */
export const defaultToolbarItems: ToolbarItem[] = [
    { id: 'bold', label: 'B', icon: 'bold', group: 'inline', isActive: formatActive('bold'), run: ({ controller }) => controller.toggleBold() },
    { id: 'italic', label: 'I', icon: 'italic', group: 'inline', isActive: formatActive('italic'), run: ({ controller }) => controller.toggleItalic() },
    { id: 'strike', label: 'S', icon: 'strikethrough', group: 'inline', isActive: formatActive('strike'), run: ({ controller }) => controller.toggleStrike() },
    { id: 'code', label: '</>', icon: 'code', group: 'inline', isActive: formatActive('code'), run: ({ controller }) => controller.toggleCode() },
    { id: 'h1', label: 'H1', icon: 'heading-1', group: 'block', isActive: headingActive(1), run: ({ controller }) => controller.setHeading(1) },
    { id: 'h2', label: 'H2', icon: 'heading-2', group: 'block', isActive: headingActive(2), run: ({ controller }) => controller.setHeading(2) },
    {
        id: 'paragraph',
        label: '¶',
        icon: 'pilcrow',
        group: 'block',
        isActive: (sel) => (sel ? sel.activeBlock === 'paragraph' : false),
        run: ({ controller }) => controller.setHeading(0),
    },
];
