/**
 * daisyUI skin for `@sigx/lynx-markdown`'s editor toolbar — the same
 * {@link ToolbarItem} contract, rendered with daisy `Button`s (ghost when
 * idle, primary when the format is active at the selection).
 *
 * Two ways to use it:
 *
 * ```tsx
 * // 1. Standalone (e.g. inside a KeyboardStickyView send bar):
 * <EditorToolbar controller={ctrl} selection={sel} />
 *
 * // 2. Re-skin MarkdownEditor's built-in toolbar:
 * <MarkdownEditor toolbar renderToolbarItem={daisyToolbarItem} />
 * ```
 */

import { component, type Define } from '@sigx/lynx';
import {
    EditorToolbar as GenericEditorToolbar,
    type MarkdownEditorController,
    type ToolbarItem,
    type ToolbarRenderItem,
    type SelectionState,
} from '@sigx/lynx-markdown/editor';
import { Button } from '../buttons/Button.js';

/** daisyUI item rendering — pass to `MarkdownEditor`'s `renderToolbarItem`. */
export const daisyToolbarItem: ToolbarRenderItem = (item, active, run) => (
    <Button
        key={item.id}
        size="sm"
        square
        color={active ? 'primary' : undefined}
        variant={active ? undefined : 'ghost'}
        onPress={run}
    >
        {item.label ?? item.id}
    </Button>
);

export type EditorToolbarProps =
    & Define.Prop<'controller', MarkdownEditorController | null, false>
    & Define.Prop<'selection', SelectionState | null, false>
    & Define.Prop<'items', ToolbarItem[], false>
    & Define.Prop<'class', string, false>;

export const EditorToolbar = component<EditorToolbarProps>(({ props }) => {
    return () => (
        <GenericEditorToolbar
            controller={props.controller}
            selection={props.selection}
            items={props.items}
            renderItem={daisyToolbarItem}
            class={props.class}
        />
    );
});
