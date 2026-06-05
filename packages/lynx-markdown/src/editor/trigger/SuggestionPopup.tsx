/**
 * `<SuggestionPopup>` — the neutral suggestion list for trigger sessions,
 * mirroring the toolbar's override pattern: items are data
 * ({@link TriggerItem}), row rendering is replaceable via `renderItem`
 * (a plugin's `trigger.renderItem`).
 *
 * Anchored by the caret rect from `bindselection`, placed above the caret by
 * default and flipped below when there's no room, and always clamped so it
 * never extends under the keyboard (`@sigx/lynx-keyboard` insets) — see
 * `position.ts` for the math. The page-absolute frame of the relative
 * container it's positioned in arrives via `containerFrame` (the editor
 * measures it with `bindlayoutchange`).
 *
 * Ships with `ignore-focus` on the root: tapping a suggestion must never
 * blur the editor (same iOS `endEditing:` rule the toolbar handles).
 */

import { component, type Define, type ElementLayout, type JSXElement } from '@sigx/lynx';
import { useKeyboard } from '@sigx/lynx-keyboard';
import type { TriggerItem } from '../plugin.js';
import { placeSuggestionPopup, screenHeightDp, type CaretRect } from './position.js';

export type SuggestionRenderItem = (item: TriggerItem, active: boolean) => JSXElement;

export type SuggestionPopupProps =
    & Define.Prop<'items', TriggerItem[], false>
    & Define.Prop<'caretRect', CaretRect | null, false>
    /** Page-absolute frame of the relative container (from `bindlayoutchange`). */
    & Define.Prop<'containerFrame', ElementLayout | null, false>
    & Define.Prop<'renderItem', SuggestionRenderItem, false>
    & Define.Prop<'onSelect', (item: TriggerItem) => void, false>
    /** Highlighted row index (e.g. hardware-keyboard navigation); `-1`/omitted = none. */
    & Define.Prop<'activeIndex', number, false>
    & Define.Prop<'maxHeight', number, false>
    & Define.Prop<'width', number, false>
    & Define.Prop<'class', string, false>;

const DEFAULT_WIDTH = 240;
const DEFAULT_MAX_HEIGHT = 220;
const BORDER = 'rgba(127, 127, 127, 0.32)';
/** Opaque neutral surface — the popup floats over editor text. */
const SURFACE = '#f4f4f5';
const ACTIVE_BG = 'rgba(128,128,128,0.25)';

export const SuggestionPopup = component<SuggestionPopupProps>(({ props }) => {
    const keyboard = useKeyboard();

    const defaultRenderItem: SuggestionRenderItem = (item, active) => (
        <view
            key={item.id}
            style={{
                paddingLeft: '12px',
                paddingRight: '12px',
                paddingTop: '8px',
                paddingBottom: '8px',
                ...(active ? { backgroundColor: ACTIVE_BG } : {}),
            }}
        >
            <text style={{ fontSize: 15 }}>{item.label}</text>
        </view>
    );

    return () => {
        const items = props.items ?? [];
        const caretRect = props.caretRect ?? { x: 0, y: 0, height: 0 };
        const frame = props.containerFrame ?? null;
        const width = props.width ?? DEFAULT_WIDTH;
        const renderItem = props.renderItem ?? defaultRenderItem;

        const pos = placeSuggestionPopup({
            caretRect,
            containerTop: frame?.top ?? 0,
            containerWidth: frame?.width ?? width,
            containerHeight: frame?.height ?? 0,
            screenHeight: screenHeightDp(),
            keyboardHeight: keyboard.value.height,
            popupWidth: width,
            maxPopupHeight: props.maxHeight ?? DEFAULT_MAX_HEIGHT,
        });

        return (
            <view
                ignore-focus={true}
                class={props.class}
                style={{
                    position: 'absolute',
                    left: pos.left,
                    ...(pos.top !== undefined ? { top: pos.top } : {}),
                    ...(pos.bottom !== undefined ? { bottom: pos.bottom } : {}),
                    width,
                    zIndex: 20,
                    borderRadius: '10px',
                    borderWidth: '1px',
                    borderColor: BORDER,
                    backgroundColor: SURFACE,
                    overflow: 'hidden',
                }}
            >
                <scroll-view scroll-orientation="vertical" style={{ maxHeight: pos.maxHeight }}>
                    {items.map((item, index) => (
                        // Accessibility lives on the tappable wrapper so screen
                        // readers treat the whole row as one button, regardless
                        // of what a custom renderItem puts inside.
                        <view
                            key={item.id}
                            bindtap={() => props.onSelect?.(item)}
                            accessibility-element={true}
                            accessibility-label={item.label}
                            accessibility-trait="button"
                        >
                            {renderItem(item, index === (props.activeIndex ?? -1))}
                        </view>
                    ))}
                </scroll-view>
            </view>
        );
    };
});
