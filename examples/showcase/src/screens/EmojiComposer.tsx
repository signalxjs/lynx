import {
    component,
    signal,
    watch,
    Platform,
    type SharedValue,
} from '@sigx/lynx';
import { Screen, BottomSheet } from '@sigx/lynx-navigation';
import { Button, Col, Row, Text, emojiClasses, useMarkdownEditorTheme } from '@sigx/lynx-daisyui';
import { LucideIcon } from '@sigx/lynx-icons-lucide/components';
import { Haptics } from '@sigx/lynx-haptics';
import { KeyboardAvoidingView, useKeyboardLift, useKeyboardLiftSV } from '@sigx/lynx-keyboard';
import { useSafeAreaInsets } from '@sigx/lynx-safe-area';
import { EmojiPicker, enData, useKeyboardPanelReveal, type EmojiPickEvent } from '@sigx/lynx-emoji';
import { List } from '@sigx/lynx-list';
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
        const revealCap = Math.max(compact + 40, screenH - (insets.value.top ?? 0) - HEADER_H);
        const full = Math.min(Math.round(screenH * 0.92), revealCap);
        const detents = [INPUT_H, compact, Math.max(compact + 40, full)];
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
                <Screen title="Chat composer" />
                {/* Chat above; padded so the newest message clears the input
                    row. KAV lifts it above the keyboard. The emoji panel
                    (when open) overlays the bottom of the thread — WhatsApp. */}
                <KeyboardAvoidingView behavior="padding">
                    <List
                        items={messages.value}
                        keyExtractor={(m) => String(m.id)}
                        inverted
                        stickToBottom
                        style={{ flexGrow: 1, paddingBottom: `${INPUT_H + 8}px` }}
                        renderItem={(m) => (
                            <view style={{ paddingLeft: '16px', paddingRight: '16px', paddingTop: '4px', paddingBottom: '4px' }}>
                                <Col
                                    class={
                                        m.author === 'me'
                                            ? 'self-end bg-primary text-primary-content rounded-xl px-3 py-2 max-w-[80%]'
                                            : 'self-start bg-base-200 rounded-xl px-3 py-2 max-w-[80%]'
                                    }
                                >
                                    <Text>{m.body}</Text>
                                </Col>
                            </view>
                        )}
                    />
                </KeyboardAvoidingView>

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
                            <Col>
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
                            </Col>
                        ),
                        default: () => (
                            // Explicit height (not flexGrow) so the picker's
                            // grid sees a non-zero region and mounts — a bare
                            // flexGrow chain through daisy `Col` measured 0.
                            <view style={{ height: `${detents[2] - INPUT_H - 32}px`, display: 'flex', flexDirection: 'column' }}>
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
                            </view>
                        ),
                    }}
                />
            </Col>
        );
    };
});
