/**
 * `<SuggestionPopup>` — the neutral suggestion list for trigger sessions,
 * mirroring the toolbar's override pattern: items are data
 * ({@link TriggerItem}), row rendering is replaceable via `renderItem`
 * (a plugin's `trigger.renderItem`).
 *
 * Anchored by the caret rect from `bindselection`, placed above the caret by
 * default and flipped below when there's no room, and clamped so it never
 * extends under the keyboard — see `position.ts` for the math. The keyboard
 * inset comes from `@sigx/lynx-keyboard`'s `useKeyboard()`, which requires a
 * `<SafeAreaProvider>` ancestor; without one it reads 0 and the keyboard
 * clamp is effectively disabled. The page-absolute frame of the relative
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
        const caretRect = props.caretRect ?? null;
        const frame = props.containerFrame ?? null;
        // Both anchors are required for meaningful placement — render nothing
        // until they exist rather than flashing at a bogus top-left position.
        if (!caretRect || !frame) return null;
        // Clamp to the container so the popup can never overflow to the right
        // in narrow layouts (placement clamps left to 0).
        const width = Math.min(props.width ?? DEFAULT_WIDTH, frame.width);
        const renderItem = props.renderItem ?? defaultRenderItem;

        const pos = placeSuggestionPopup({
            caretRect,
            containerTop: frame.top,
            containerWidth: frame.width,
            containerHeight: frame.height,
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
                    {items.map((item, index) => {
                        const active = index === (props.activeIndex ?? -1);
                        return (
                            // Accessibility lives on the tappable wrapper so
                            // screen readers treat the whole row as one button,
                            // regardless of what a custom renderItem puts inside.
                            <view
                                key={item.id}
                                bindtap={() => props.onSelect?.(item)}
                                accessibility-element={true}
                                accessibility-label={item.label}
                                accessibility-trait="button"
                                accessibility-status={active ? 'selected' : undefined}
                            >
                                {renderItem(item, active)}
                            </view>
                        );
                    })}
                </scroll-view>
            </view>
        );
    };
});
