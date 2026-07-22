import {
    component,
    signal,
    watch,
    onMounted,
    onUnmounted,
    Platform,
    type SharedValue,
} from '@sigx/lynx';
import { Screen, BottomSheet } from '@sigx/lynx-navigation';
import { Button, Col, Row, Text, emojiClasses, markdownComponents, useMarkdownEditorTheme } from '@sigx/lynx-daisyui';
import { LucideIcon } from '@sigx/lynx-icons-lucide/components';
import { Haptics } from '@sigx/lynx-haptics';
import { useKeyboardLift, useKeyboardLiftSV } from '@sigx/lynx-keyboard';
import { useSafeAreaInsets } from '@sigx/lynx-safe-area';
import { EmojiPicker, enData, useKeyboardPanelReveal, type EmojiPickEvent } from '@sigx/lynx-emoji';
import { List } from '@sigx/lynx-list';
import { createMentionPlugin, MarkdownView, mentionSyntax, type MentionCandidate } from '@sigx/lynx-markdown';
import { MarkdownEditor, type MarkdownEditorController } from '@sigx/lynx-markdown/editor';

interface Msg {
    id: number;
    author: 'me' | 'friend';
    body: string;
}

const REPLIES = [
    'Nice! 😄',
    'The input is the top of the sheet — drag it up for more 👆',
    'And the whole thing rides above the keyboard 🤌',
    'Tap the input — the keyboard comes straight back.',
    'Drag down to collapse it again ⬇️',
    '👍👍',
];

const SEED: Msg[] = [
    { id: 0, author: 'friend', body: 'This is the WhatsApp composer pattern 👇' },
    { id: 1, author: 'me', body: 'Tap 🙂 — the input + emoji are ONE draggable sheet…' },
    { id: 2, author: 'friend', body: '…drag the input up to grow it, the chat stays live behind. Try it!' },
];

/** Input-row height (px) — the sheet's collapsed floor; the input is pinned here. */
const INPUT_H = 64;
/**
 * Identity-stable style for the picker — a fresh `{flexGrow:1}` object each
 * render would change `props.style` and re-run EmojiPicker's render (re-mapping
 * ~2000 rows + re-diffing the List) on EVERY mode toggle. Hoisted so the
 * picker's props stay identity-stable and it never re-renders on a swap.
 */
const PICKER_STYLE = { flexGrow: 1 } as const;
/** Fallback emoji-panel height before a keyboard has ever opened (dp). */
const DEFAULT_KB = 320;

const MENTIONS: MentionCandidate[] = [
    { id: 'u1', label: 'Andy', kind: 'user' },
    { id: 'u2', label: 'Bea', kind: 'user' },
    { id: 'u3', label: 'Carol', kind: 'user' },
    { id: 'u4', label: 'Dimitri', kind: 'user' },
];

/**
 * Mentions inside the sheet — the case that proves the suggestion popup
 * places against the composer's LIVE position (#755). The sheet rides the
 * keyboard on a main-thread transform, so a placement derived from layout
 * coordinates would flip the list below the caret and hide it behind the
 * keyboard.
 */
const mentionPlugin = createMentionPlugin({
    search: (q) => MENTIONS.filter((u) => u.label.toLowerCase().startsWith(q.toLowerCase())),
});

// A sent message carries `@[label](id)` — render it as a chip rather than raw
// source, the same mapping the Markdown composer uses for its bubbles.
const bubbleComponents = {
    ...markdownComponents,
    extension: {
        ...markdownComponents.extension,
        mention: ({ attrs }: { attrs: Record<string, string> }) => (
            <text class="bg-base-100 text-primary rounded px-1 font-semibold">@{attrs.label}</text>
        ),
    },
};

/**
 * Chat composer (WhatsApp-style) — the input + emoji picker are ONE persistent
 * `<BottomSheet>` docked at the bottom, input pinned to its top:
 *
 *  • The sheet's collapsed floor is just the input row. Tapping the input
 *    raises the keyboard; the sheet's `liftSV` rides it up so the input sits
 *    right above the keyboard (no jump).
 *  • Tapping 🙂 blurs the editor (keyboard falls) and opens the sheet to its
 *    compact detent = keyboard height, so the emoji panel takes exactly the
 *    keyboard's space (pixel-stable swap).
 *  • DRAG the input/handle up → the sheet grows to the full detent (taller
 *    grid); drag down → back to compact, or to the floor (back to typing).
 *    The drag follows the finger (a `translateY` transform, MT-safe).
 *  • The chat stays live and undimmed behind it (the sheet is inline, not a
 *    modal route) — only padded so the newest message clears the input.
 *
 * The single editor lives in the sheet; there is no second input.
 */
export const EmojiComposerScreen = component(() => {
    const editorTheme = useMarkdownEditorTheme();
    const draftEmpty = signal(true);
    const insets = useSafeAreaInsets();
    const messages = signal<{ value: Msg[] }>({ value: [...SEED] });
    const ctrlBox = signal<{ current: MarkdownEditorController | null }>({ current: null });
    let nextId = SEED.length;
    let replyIndex = 0;

    const append = (m: Msg): void => { messages.value = [...messages.value, m]; };

    // Keyboard lift as a SharedValue — the sheet rides above it (animated on
    // the MT).
    const kbLiftSV = useKeyboardLiftSV();
    // Remember the tallest keyboard so the compact (emoji) detent == the
    // keyboard-mode lift, or the input hops between modes. Track it from the
    // BG-reactive `useKeyboardLift()` computed — NOT `kbLiftSV.value`: that SV
    // is written on the MT (the animated tween), and its BG-side value stays
    // at the seed, so `rememberedKb` never left 0 and the panel fell back to
    // DEFAULT_KB (≠ the real keyboard) → the input jumped. Same discount as
    // the SV so both detents use identical numbers.
    const kbLiftBG = useKeyboardLift();
    let rememberedKb = 0;
    watch(() => kbLiftBG.value, (h) => { if (h > rememberedKb) rememberedKb = h; });
    const screenH = Platform.pixelHeight / (Platform.pixelRatio || 1);

    // Warm the emoji grid a beat AFTER the chat has had its first layout, then
    // keep it mounted for the screen's life. Two constraints pull against each
    // other: mounting the ~2000-row grid in the SAME frame as the chat List
    // collapses the List's self-measurement (the thread doesn't fill and the
    // underneath screen bleeds through); but mounting it cold on first open
    // makes that first scroll flicker. Warming just after mount satisfies both —
    // the chat lays out first, then the grid mounts and stays warm so opening
    // emoji (always well after this tick) is a jank-free instant swap.
    const pickerWarm = signal(false);
    const warmPicker = (): void => { if (!pickerWarm.value) pickerWarm.value = true; };
    // Primary trigger: warm as soon as the keyboard is first raised (the user
    // tapped the input). The chat has long since laid out by then, so mounting
    // the grid here can't disturb its measurement.
    watch(() => kbLiftBG.value, (h) => { if (h > 0) warmPicker(); });
    // Fallback: also warm shortly after mount, so opening emoji straight away
    // (this demo's "Tap 🙂" CTA — no keyboard first) is jank-free too. The delay
    // lets the chat lay out first. Cleared on unmount so it can't fire (and warm
    // a torn-down signal) after the screen is popped.
    let warmTimer: ReturnType<typeof setTimeout> | null = null;
    onMounted(() => { warmTimer = setTimeout(warmPicker, 150); });
    onUnmounted(() => { if (warmTimer !== null) clearTimeout(warmTimer); });

    // Flip to true and rebuild to log the geometry to logcat (lynx_console)
    // for on-device confirmation of the height match.
    const DEBUG_GEOM = false;

    // The sheet's live reveal height (captured for potential sibling binding).
    let revealSV: SharedValue<number> | null = null;

    const insertPick = (e: EmojiPickEvent): void => {
        ctrlBox.current?.insertText(e.glyph);
        draftEmpty.value = false;
    };

    // The tested reveal state machine (blur/focus + settle timing) — the same
    // dip-free WhatsApp swap, now driving the inline sheet's `open`:
    //  • `open`   → blur (keyboard falls, uncovering the painted sheet);
    //  • `closing`→ focus (keyboard rises OVER the still-painted sheet), held
    //    until the settle so the swap never dips;
    //  • `closed` → sheet parked at the floor (input only).
    // The sheet is painted INSTANTLY at its detent (`animate={false}`) — only
    // the keyboard's own slide animates. The editor is `disabled` while
    // `open`, so it can't re-grab focus and pop the keyboard back over the
    // emojis; tapping it (`close`) re-enables + focuses it on purpose.
    const reveal = useKeyboardPanelReveal({
        blur: () => ctrlBox.current?.blur(),
        focus: () => ctrlBox.current?.focus(),
    });
    const toggle = (): void => {
        if (reveal.mode() === 'open') reveal.close();
        else reveal.open();
        Haptics.selection();
    };
    const backToKeyboard = (): void => {
        if (reveal.mode() === 'open') reveal.close();
    };

    const send = (): void => {
        const body = (ctrlBox.current?.getMarkdown() ?? '').trim();
        if (!body) return;
        Haptics.selection();
        ctrlBox.current?.clear();
        draftEmpty.value = true;
        append({ id: nextId++, author: 'me', body });
        setTimeout(() => {
            append({ id: nextId++, author: 'friend', body: REPLIES[replyIndex++ % REPLIES.length] });
        }, 700);
    };

    return () => {
        // The emoji panel must fill the SAME rectangle the soft keyboard did.
        // `rememberedKb` (the keyboard LIFT) is inset-DISCOUNTED — an ancestor
        // SafeAreaView already pads the home-indicator strip that the keyboard
        // covers when open. The inline sheet reaches the true screen bottom, so
        // the panel must add that bottom inset back or it lands `bottomInset`
        // px short and the input hops on every swap. Device-general: both
        // terms are runtime values (any keyboard, any inset, iOS/Android).
        const kb = rememberedKb > 0
            ? rememberedKb + (insets.value.bottom ?? 0)
            : DEFAULT_KB;
        const compact = INPUT_H + kb;                      // input + keyboard-height panel
        // Max reveal never lifts the sheet's top above the header/safe area —
        // the input must stay on-screen at full extension (BUG 3). The sheet's
        // top sits at `screenH - reveal`, so cap reveal at `screenH - safeTop
        // - header`.
        const HEADER_H = 56;
        // The sheet's top sits at `screenH - reveal`, so keeping the input
        // below the header/safe area means reveal must not EXCEED this cap.
        const revealCap = screenH - (insets.value.top ?? 0) - HEADER_H;
        // Clamp every detent to the cap — even `compact` and the expanded
        // stage — so on short screens / landscape the top never slides under
        // the header. `full` still sits above compact whenever there's room.
        const compactCapped = Math.min(compact, revealCap);
        const full = Math.min(Math.round(screenH * 0.92), revealCap);
        // Collapsed floor = just the input row. The sheet's bottom already sits
        // at the safe-area line (an ancestor `<SafeAreaView edges={['bottom']}>`
        // pads the gesture bar), so the row lands clear of it — adding the inset
        // here again would float the row a full inset too high.
        const floorH = INPUT_H;
        const detents = [floorH, compactCapped, Math.max(compactCapped, full)];
        const mode = reveal.mode();
        const engaged = mode !== 'closed';
        void revealSV;

        if (DEBUG_GEOM) {
            // eslint-disable-next-line no-console
            console.log('[composer-geom]', JSON.stringify({
                mode,
                rememberedKb,
                kbLiftBG: kbLiftBG.value,
                usedKb: kb,
                compact,
                inputH: INPUT_H,
                bottomInset: insets.value.bottom,
            }));
        }

        return (
            <Col class="flex-fill bg-base-100">
                {/* Opaque backdrop that fills the whole screen layer. In this
                    modal chain the flex root doesn't stretch to the layer's top
                    edge, leaving a strip the underneath screen bleeds through.
                    An absolutely-positioned child resolves against the layer's
                    positioned host (not the flex box), so it covers the full
                    surface; rendered first, it sits behind the thread. */}
                <view class="bg-base-100" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
                <Screen title="Chat composer" />
                {/* Chat thread — a DIRECT child of the root column (no
                    KeyboardAvoidingView wrapper): the extra flex layer collapsed
                    the list's self-measurement in this modal chain, leaving a gap
                    the underneath screen bled through. The composer sheet already
                    rides the keyboard via its `liftSV`, so the thread doesn't need
                    to avoid the keyboard itself — it stays live behind the sheet
                    (WhatsApp). `paddingBottom` keeps the newest message clear of
                    the input row. */}
                <List
                    items={messages.value}
                    keyExtractor={(m) => String(m.id)}
                    inverted
                    stickToBottom
                    // Mount the list at ≈ its real height on frame 1 instead of
                    // racing up from a 1px placeholder — the mount frame lays out
                    // at full size, so `layoutcomplete` lands and the chat-mode
                    // reveal is deterministic.
                    initialMainAxisSize={Math.round(screenH - (insets.value.top ?? 0) - HEADER_H)}
                    // Long-form fill (NOT a bare `flexGrow: 1`): in Lynx a
                    // `flexGrow`-only box keeps `flexBasis: 'auto'` and sizes to
                    // content, collapsing the thread; `flexBasis: 0` + `minHeight: 0`
                    // is the Lynx-correct "take the remaining space".
                    style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, paddingBottom: `${floorH + 8}px` }}
                    renderItem={(m) => (
                        <view style={{ paddingLeft: '16px', paddingRight: '16px', paddingTop: '4px', paddingBottom: '4px' }}>
                            <Col
                                class={
                                    m.author === 'me'
                                        ? 'self-end bg-primary text-primary-content rounded-xl px-3 py-2 max-w-[80%]'
                                        : 'self-start bg-base-200 rounded-xl px-3 py-2 max-w-[80%]'
                                }
                            >
                                {m.body.includes('@[')
                                    ? <MarkdownView value={m.body} extensions={[mentionSyntax]} components={bubbleComponents} />
                                    : <Text>{m.body}</Text>}
                            </Col>
                        </view>
                    )}
                />

                {/* The composer sheet: [input row + pill] (handle, draggable)
                    over [emoji picker] (body, scrolls). Floor = input only;
                    open = compact (keyboard height); drag up = full. */}
                <BottomSheet
                    maxHeight={detents[2]}
                    detents={detents}
                    open={engaged}
                    openDetentIndex={1}
                    // On open, capture the LIVE lifted position (== the exact
                    // keyboard-mode height, read on the MT) as the emoji rest —
                    // so when the keyboard's lift animates to 0 the input does
                    // NOT move. A BG-computed `compact` detent can't equal the
                    // live MT keyboard lift, which is what caused the residual
                    // input jump; the detent below is only the no-keyboard
                    // fallback. Device-general: nothing hardcoded.
                    openToLift
                    dragEnabled={mode === 'open'}
                    liftSV={kbLiftSV}
                    onReveal={(sv) => { revealSV = sv; }}
                    onSnap={(i) => { if (i === 0 && reveal.mode() === 'open') backToKeyboard(); }}
                    class="bg-base-100 border-t border-base-300"
                    slots={{
                        handle: () => (
                            // Input row FIRST, drag pill BELOW it (WhatsApp) — the
                            // input is the fixed top anchor, so entering emoji mode
                            // adds the pill+grid BELOW it and the input never jumps.
                            <view style={{ display: 'flex', flexDirection: 'column' }}>
                                <view ignore-focus={true}>
                                    <Row gap={8} align="flex-end" class="px-2 py-2" style={{ height: `${INPUT_H}px` }}>
                                        <Button variant="ghost" circle onPress={toggle}>
                                            {/* Flip the toggle icon on `mode === 'open'`, not
                                                `engaged`: tapping to return to the keyboard enters
                                                `closing` (panel held while the keyboard rises) — the
                                                affordance must switch to 🙂 IMMEDIATELY, not linger
                                                for the settle. */}
                                            <LucideIcon name={mode === 'open' ? 'keyboard' : 'smile'} size={24} color="#8A93A2" />
                                        </Button>
                                        <view
                                            class="flex-1 border border-base-300 rounded-2xl px-2"
                                            bindtap={() => { backToKeyboard(); }}
                                        >
                                            <MarkdownEditor
                                                placeholder="Message"
                                                minLines={1}
                                                maxLines={4}
                                                confirmType="send"
                                                // Disabled while the emoji panel is fully open, so
                                                // it can't re-grab focus and pop the keyboard back
                                                // over the emojis (BUG 1). Re-enabled in `closing`
                                                // (the tap-to-return path focuses it on purpose).
                                                disabled={mode === 'open'}
                                                plugins={[mentionPlugin]}
                                                suggestionPopup={editorTheme.suggestionPopup}
                                                textColor={editorTheme.textColor}
                                                accentColor={editorTheme.accentColor}
                                                placeholderColor={editorTheme.placeholderColor}
                                                onChange={(md) => { draftEmpty.value = md.trim() === ''; }}
                                                onFocus={() => { backToKeyboard(); }}
                                                controllerRef={(ctrl) => { ctrlBox.current = ctrl; }}
                                            />
                                        </view>
                                        <Button color="primary" circle disabled={draftEmpty.value} onPress={send}>
                                            <LucideIcon name="send-horizontal" size={20} color="#FFFFFF" />
                                        </Button>
                                    </Row>
                                </view>
                                {engaged && (
                                    <Col align="center" class="pt-1 pb-2">
                                        <view class="w-10 h-1 rounded-full bg-base-300" />
                                    </Col>
                                )}
                            </view>
                        ),
                        default: () => (
                            // Warm-but-collapsed picker. When the panel isn't open the
                            // OUTER wrapper collapses to `height: 0; overflow: hidden`
                            // so nothing shows in the sheet's floor slice (previously
                            // the picker's search row peeked below the input); when open
                            // it takes the panel height. The INNER wrapper keeps the full
                            // height in BOTH states, so the grid never measures a
                            // zero-height region (that floods DispatchEvent, #606) and
                            // the picker stays mounted (warm) for a jank-free first open.
                            <view
                                style={engaged
                                    ? { height: `${detents[2] - INPUT_H - 32}px`, display: 'flex', flexDirection: 'column' }
                                    : { height: '0px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
                            >
                                <view style={{ height: `${detents[2] - INPUT_H - 32}px`, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                                    {pickerWarm.value && (
                                        <EmojiPicker
                                            data={enData}
                                            showSearch
                                            onPick={insertPick}
                                            // Daisy skin — gives the sticky section headers their
                                            // opaque `bg-base-100`; without it the headless header
                                            // fallback is transparent and emojis scroll through it.
                                            classes={emojiClasses}
                                            style={PICKER_STYLE}
                                        />
                                    )}
                                </view>
                            </view>
                        ),
                    }}
                />
            </Col>
        );
    };
});
