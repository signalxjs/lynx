/**
 * `<EditorToolbar>` — the neutral formatting toolbar for `MarkdownEditor`,
 * mirroring the renderer's override pattern: the *items* are data (the
 * core's {@link ToolbarItem}), the *rendering* is replaceable per item via
 * `renderItem` (that's all a design-system skin is — see
 * `@sigx/lynx-daisyui`'s `EditorToolbar`). Active and enabled states come
 * from the core's `toolbarState()` over the editor's live state.
 *
 * Ships with `ignore-focus` on the root: toolbar taps must never blur the
 * editor — on iOS, Lynx dispatches `endEditing:` on any touch-down whose
 * target doesn't ignore focus, folding the keyboard before the tapped
 * command could run.
 *
 * Usable two ways:
 * - **Built in**: `<MarkdownEditor toolbar />` (or `toolbar="top"`).
 * - **Standalone**: place it anywhere (e.g. a `KeyboardStickyView` send bar)
 *   and pass the `controller` from `controllerRef`.
 */

import { component, type Define, type JSXElement } from '@sigx/lynx';
import type { ToolbarContext, ToolbarItem, ToolbarState } from '@sigx/markdown/editor';
import { defaultToolbarItems, toolbarState } from '@sigx/markdown/editor';
import type { MarkdownEditorController } from '../MarkdownEditor.js';
import { track } from '../view.js';

export type ToolbarRenderItem = (item: ToolbarItem, active: boolean, run: () => void, enabled: boolean) => JSXElement;

export type EditorToolbarProps =
    & Define.Prop<'controller', MarkdownEditorController | null, false>
    /** Base items (default: the core's `defaultToolbarItems`); the editor's plugin items append. */
    & Define.Prop<'items', readonly ToolbarItem[], false>
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
    const context = (): ToolbarContext | null => {
        const controller = props.controller;
        if (!controller) return null;
        const { editor } = controller;
        return { state: editor.state, dispatch: editor.dispatch, ctx: editor.ctx, run: (command) => editor.run(command) };
    };

    const defaultRenderItem: ToolbarRenderItem = (item, active, runItem, enabled) => (
        <view
            key={item.id}
            style={{ ...ITEM_STYLE, ...(active ? { backgroundColor: ACTIVE_BG } : {}), ...(enabled ? {} : { opacity: 0.4 }) }}
            bindtap={runItem}
            accessibility-element={true}
            accessibility-label={item.label ?? item.id}
            accessibility-trait="button"
            accessibility-status={active ? 'selected' : undefined}
        >
            <text style={active ? { fontWeight: 'bold' } : undefined}>{item.label ?? item.id}</text>
        </view>
    );

    return () => {
        const controller = props.controller;
        const editor = controller?.editor;
        // Reactive on both revisions so active states follow the caret and the document.
        if (editor) track(editor.selRev.value, editor.rev.value);
        const tb: ToolbarState | null = editor ? toolbarState(editor.state, editor.ctx, editor.history) : null;
        const items = [...(props.items ?? defaultToolbarItems), ...(editor?.toolbarItems ?? [])];
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
                {items.map((item) => {
                    const active = tb ? (item.isActive?.(tb) ?? false) : false;
                    const enabled = !!tb && !editor!.readOnly && (item.isEnabled ? item.isEnabled(tb) : tb.mode !== 'none');
                    const run = (): void => {
                        const tc = context();
                        if (tc && enabled) item.run(tc);
                    };
                    return renderItem(item, active, run, enabled);
                })}
            </view>
        );
    };
});
