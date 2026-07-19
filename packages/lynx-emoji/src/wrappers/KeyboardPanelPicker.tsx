import { component, signal, watch, type Define } from '@sigx/lynx';
import { useKeyboardLift } from '@sigx/lynx-keyboard';
import type { EmojiPickEvent } from '../types.js';
import { EmojiPicker, type EmojiPickerProps } from '../components/EmojiPicker.js';

export type KeyboardPanelPickerProps =
    & Omit<EmojiPickerProps, 'style' | 'onPick'>
    /** Whether the panel is shown (toggle from your composer's emoji button). */
    & Define.Prop<'open', boolean, true>
    /** Fallback panel height before the keyboard has ever opened. Default 300. */
    & Define.Prop<'fallbackHeight', number, false>
    /**
     * Pre-mount the picker before the first open, so opening is an instant
     * style swap instead of a fresh mount. The hidden picker keeps its REAL
     * panel size — the inner grid is never zero-height (that would flood
     * scroll events, #606) — while an outer wrapper collapses to `height: 0`
     * with `overflow: hidden`, so it takes no flow space and is unhittable
     * until opened (`display:none` would throw the mount away between
     * toggles). Recommended for chat composers.
     */
    & Define.Prop<'warm', boolean, false>
    /**
     * Render the open panel at THIS height (px) instead of the keyboard's —
     * the expanded stage of a two-stage picker (WhatsApp: drag the composer
     * up for a taller grid + search). Omit for the compact stage.
     *
     * The compact height stays the remembered keyboard lift regardless, so
     * the keyboard ⇄ panel swap is still pixel-stable: expansion is a
     * user-driven state ON TOP of that invariant, never a replacement for
     * it. Collapse back to compact before letting the keyboard return, or
     * the returning keyboard's space won't match the painted panel.
     */
    & Define.Prop<'expandedHeight', number, false>
    & Define.Event<'pick', EmojiPickEvent>;

/**
 * The chat-composer presentation: a panel that occupies exactly the soft
 * keyboard's space, so toggling emoji ⇄ keyboard doesn't shift the composer
 * (the WhatsApp/Telegram pattern). Place it as the last child of a
 * `<KeyboardStickyView>`, under the input row; the panel height comes from
 * `useKeyboardLift()` (the inset-discounted lift — the exact distance the
 * sticky bar travels; needs a `<SafeAreaProvider>` ancestor) and the largest
 * height seen is remembered so the panel keeps the right size after the
 * keyboard dismisses.
 *
 * Once the picker has mounted (first open, or immediately with `warm`) it
 * STAYS mounted across toggles — closed means collapsed by a 0-height,
 * overflow-hidden wrapper while the grid keeps its full size, so scroll
 * position, recents and staged rows all survive, and reopening is instant.
 *
 * ```tsx
 * <KeyboardStickyView>
 *   <Composer onEmojiButton={() => toggle()} />
 *   <KeyboardPanelPicker warm open={open.value} data={data} onPick={insert} />
 * </KeyboardStickyView>
 * ```
 */
export const KeyboardPanelPicker = component<KeyboardPanelPickerProps>(({ props, emit }) => {
    // Remember the keyboard LIFT (inset-discounted — the exact distance
    // KeyboardStickyView travels), not the raw keyboard height: the panel
    // replaces the LIFT when the bar is pinned, so equal numbers make the
    // keyboard ⇄ panel swap pixel-stable.
    //
    // FROZEN WHILE PAINTED: adopting a new height while the panel is open
    // (including the closing transition, when the returning keyboard's
    // final height arrives) would resize the painted panel and move the bar
    // mid-swap — the one thing this component exists to prevent. The latest
    // positive lift is tracked continuously but APPLIED only while parked,
    // which also handles shrink (an IME suggestion strip toggling between
    // cycles), not just growth.
    const lift = useKeyboardLift();
    const panelHeight = signal(0);
    let latestLift = 0;
    watch(() => lift.value, (h) => {
        if (h > 0) latestLift = h;
        if (!props.open && h > 0 && h !== panelHeight.value) panelHeight.value = h;
    });
    watch(() => props.open, (open) => {
        if (!open && latestLift > 0 && latestLift !== panelHeight.value) {
            panelHeight.value = latestLift;
        }
    });
    // Sticky: once the picker exists it is never unmounted by a toggle.
    let everOpen = false;

    return () => {
        if (props.open) everOpen = true;
        if (!props.open && !everOpen && props.warm !== true) {
            return <view style={{ display: 'none' }} />;
        }
        // Compact = the remembered keyboard lift (the swap invariant);
        // `expandedHeight` overrides it for the expanded stage only, and
        // never feeds back into the remembered lift above.
        const compact = panelHeight.value > 0 ? panelHeight.value : (props.fallbackHeight ?? 300);
        const expanded = props.expandedHeight ?? 0;
        const height = props.open && expanded > 0 ? expanded : compact;
        // Closed-but-mounted: an OUTER collapse to 0px (zero flow footprint —
        // the bar must hug the bottom while closed) clips an INNER view that
        // keeps the full panel height in BOTH states, so the picker's grid
        // never sees a zero-height box (#606) and its measured geometry
        // survives toggles untouched. Deliberately the plainest style
        // vocabulary there is (height + clipping) — no absolute positioning
        // or transforms, whose inline-style behavior has burnt us on device.
        const outer: Record<string, string | number> = props.open
            ? { height: `${height}px`, display: 'flex', flexDirection: 'column' }
            : { height: '0px', overflow: 'hidden', display: 'flex', flexDirection: 'column' };
        return (
            <view style={outer}>
                <view style={{ height: `${height}px`, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                    <EmojiPicker
                    data={props.data}
                    columns={props.columns}
                    showRecents={props.showRecents}
                    showSearch={props.showSearch}
                    searchPlaceholder={props.searchPlaceholder}
                    cellSize={props.cellSize}
                    classes={props.classes}
                    class={props.class}
                    renderCell={props.renderCell}
                    renderCategoryTab={props.renderCategoryTab}
                    renderSearchInput={props.renderSearchInput}
                    onPick={(e) => emit('pick', e)}
                    />
                </view>
            </view>
        );
    };
});
