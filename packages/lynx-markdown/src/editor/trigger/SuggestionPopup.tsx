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

/**
 * Consumer-facing styling for the trigger suggestion popup — the bundle
 * `MarkdownEditor` forwards via its `suggestionPopup` prop. Every field is
 * optional; omitted ones keep the neutral, theme-agnostic defaults. A themed
 * host (e.g. daisyUI's `useMarkdownEditorTheme().suggestionPopup`) fills these
 * with concrete theme colors. Generic to *any* trigger — carries no
 * plugin-specific knowledge.
 */
export interface SuggestionPopupStyle {
    /** Extra root class on the popup container (layout tweaks). */
    class?: string;
    /** Popup width in dp (clamped to the editor width). Default 240. */
    width?: number;
    /** Max popup height in dp before it scrolls. Default 220. */
    maxHeight?: number;
    /** Surface (background) color. Default neutral light gray. */
    surfaceColor?: string;
    /** Border color. Default neutral translucent gray. */
    borderColor?: string;
    /** Active-row background (built-in `renderItem`). Default neutral gray. */
    activeColor?: string;
    /** Text color for the built-in `renderItem`. Default inherits. */
    textColor?: string;
}

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
    & Define.Prop<'class', string, false>
    /**
     * Popup surface (background) color. Defaults to a neutral light gray so the
     * renderer stands alone on any platform; a themed host (e.g. daisyUI) passes
     * a concrete theme color so the popup matches a dark/light app.
     */
    & Define.Prop<'surfaceColor', string, false>
    /** Popup border color. Defaults to a neutral translucent gray. */
    & Define.Prop<'borderColor', string, false>
    /** Active-row background, used by the built-in `renderItem`. Neutral default. */
    & Define.Prop<'activeColor', string, false>
    /**
     * Text color for the built-in `renderItem` (a custom `renderItem` owns its
     * own colors). Unset → inherit; a themed host passes the theme's text color
     * so the default row stays readable on a dark surface.
     */
    & Define.Prop<'textColor', string, false>;

const DEFAULT_WIDTH = 240;
const DEFAULT_MAX_HEIGHT = 220;
/** Neutral, theme-agnostic defaults — a themed host overrides via props. */
const DEFAULT_BORDER = 'rgba(127, 127, 127, 0.32)';
/** Opaque neutral surface — the popup floats over editor text. */
const DEFAULT_SURFACE = '#f4f4f5';
/** Opaque dark surface — the derived counterpart of {@link DEFAULT_SURFACE}. */
const DARK_SURFACE = '#1f1f23';
const DEFAULT_ACTIVE_BG = 'rgba(128,128,128,0.25)';

/** Parse `#RGB`/`#RGBA`/`#RRGGBB`/`#RRGGBBAA` to 0–255 channels (alpha ignored); `null` otherwise. */
function parseHexRgb(color: string): { r: number; g: number; b: number } | null {
    const c = color.trim();
    if (!c.startsWith('#')) return null;
    let h = c.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split('').map((ch) => ch + ch).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    // Validate every digit (incl. the alpha bytes) — `Number.parseInt` would
    // silently stop at the first non-hex char (e.g. `#12345g` → `0x12345`) or
    // ignore trailing junk (`#fffz` → `ffffffzz` → `0xffffff`), letting a
    // malformed color drive the derived style instead of falling back.
    if (!/^[0-9a-fA-F]+$/.test(h)) return null;
    return {
        r: Number.parseInt(h.slice(0, 2), 16),
        g: Number.parseInt(h.slice(2, 4), 16),
        b: Number.parseInt(h.slice(4, 6), 16),
    };
}

/**
 * Synthesize a popup style from the editor's resolved `textColor`, so a host
 * that themes the editor body (`textColor`) but leaves the popup colors unset
 * still gets a popup that doesn't clash — the white-on-dark trap. Used by
 * `MarkdownEditor` as a *per-field fallback*: it spreads this before any
 * explicit `suggestionPopup`, so each color the host sets (e.g. daisyUI's
 * `useMarkdownEditorTheme().suggestionPopup`) wins, while colors it omits —
 * including when it passes only layout fields (`width`/`maxHeight`/`class`) —
 * fall back to this tint rather than the neutral light default.
 *
 *  • `surfaceColor` flips to a dark neutral when the text is light (every daisy
 *    theme's `base-100` is the near-inverse luminance of `base-content`), else
 *    keeps the light neutral.
 *  • `borderColor`/`activeColor` are the text color at low alpha, so they read
 *    on either surface.
 *
 * Returns `{}` for an absent or non-hex color (named/`rgb()`), leaving the
 * neutral standalone defaults untouched — no regression for unthemed use.
 */
export function derivePopupStyleFromText(textColor?: string): SuggestionPopupStyle {
    if (!textColor) return {};
    const rgb = parseHexRgb(textColor);
    if (!rgb) return {};
    // Perceptual luminance, 0–1.
    const lum = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
    const rgba = (a: number): string => `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
    return {
        surfaceColor: lum > 0.5 ? DARK_SURFACE : DEFAULT_SURFACE,
        borderColor: rgba(0.25),
        activeColor: rgba(0.12),
        textColor,
    };
}

export const SuggestionPopup = component<SuggestionPopupProps>(({ props }) => {
    const keyboard = useKeyboard();

    const defaultRenderItem: SuggestionRenderItem = (item, active) => (
        <view
            style={{
                paddingLeft: '12px',
                paddingRight: '12px',
                paddingTop: '8px',
                paddingBottom: '8px',
                ...(active ? { backgroundColor: props.activeColor ?? DEFAULT_ACTIVE_BG } : {}),
            }}
        >
            <text style={{ fontSize: 15, ...(props.textColor ? { color: props.textColor } : {}) }}>
                {item.label}
            </text>
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
                    borderColor: props.borderColor ?? DEFAULT_BORDER,
                    backgroundColor: props.surfaceColor ?? DEFAULT_SURFACE,
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
