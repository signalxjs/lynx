/**
 * `<EditorToolbar>` — the neutral formatting toolbar for `MarkdownEditor`,
 * mirroring the renderer's override pattern: the *items* are data
 * ({@link ToolbarItem}), the *rendering* is replaceable per item via
 * `renderItem` (that's all a design-system skin is — see
 * `@sigx/lynx-daisyui`'s `EditorToolbar`).
 *
 * Ships with `ignore-focus` on the root: toolbar taps must never blur the
 * editor — on iOS, Lynx dispatches `endEditing:` on any touch-down whose
 * target doesn't ignore focus, folding the keyboard before the tapped
 * command could run.
 *
 * Usable two ways:
 * - **Built in**: `<MarkdownEditor toolbar />` (or `toolbar="top"`), which
 *   wires `controller`/`selection` internally.
 * - **Standalone**: place it anywhere (e.g. a `KeyboardStickyView` send bar)
 *   and pass `controller` + `selection` yourself.
 */

import { component, type Define, type JSXElement } from '@sigx/lynx';
import type { SelectionState } from '@sigx/lynx-richtext';
import type { MarkdownEditorController } from '../MarkdownEditor.js';
import type { ToolbarItem } from './items.js';
import { defaultToolbarItems } from './items.js';

export type ToolbarRenderItem = (
    item: ToolbarItem,
    active: boolean,
    run: () => void,
) => JSXElement;

export type EditorToolbarProps =
    & Define.Prop<'controller', MarkdownEditorController | null, false>
    & Define.Prop<'selection', SelectionState | null, false>
    & Define.Prop<'items', ToolbarItem[], false>
    & Define.Prop<'renderItem', ToolbarRenderItem, false>
    & Define.Prop<'class', string, false>;

/** Neutral, theme-agnostic item chrome (mid-gray works on light + dark). */
const ITEM_STYLE = {
    paddingLeft: '10px',
    paddingRight: '10px',
    paddingTop: '6px',
    paddingBottom: '6px',
    borderRadius: '6px',
} as const;
const ACTIVE_BG = 'rgba(128,128,128,0.25)';

export const EditorToolbar = component<EditorToolbarProps>(({ props }) => {
    const run = (item: ToolbarItem): void => {
        const controller = props.controller;
        if (controller) item.run({ controller });
    };

    const defaultRenderItem: ToolbarRenderItem = (item, active, runItem) => (
        <view
            key={item.id}
            style={{ ...ITEM_STYLE, ...(active ? { backgroundColor: ACTIVE_BG } : {}) }}
            bindtap={runItem}
        >
            <text style={active ? { fontWeight: 'bold' } : undefined}>{item.label}</text>
        </view>
    );

    return () => {
        const items = props.items ?? defaultToolbarItems;
        const sel = props.selection ?? null;
        const renderItem = props.renderItem ?? defaultRenderItem;
        return (
            <view
                ignore-focus={true}
                class={props.class}
                style={{
                    display: 'flex',
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    columnGap: '4px',
                    rowGap: '4px',
                }}
            >
                {items.map((item) => renderItem(item, item.isActive?.(sel) ?? false, () => run(item)))}
            </view>
        );
    };
});
