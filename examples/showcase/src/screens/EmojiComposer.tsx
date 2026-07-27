import {
    component,
    signal,
    watch,
    onMounted,
    onUnmounted,
    Platform,
    defineProvide,
    useMainThreadRef,
    type JSXElement,
    type MainThread,
    type SharedValue,
} from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { BottomSheet } from '@sigx/lynx-sheet';
import {
    Button,
    Col,
    Row,
    Text,
    emojiClassesBottomTabs,
    markdownComponents,
    useMarkdownEditorTheme,
} from '@sigx/lynx-daisyui';
import { LucideIcon } from '@sigx/lynx-icons-lucide/components';
import { Haptics } from '@sigx/lynx-haptics';
import { useKeyboardLift, useKeyboardLiftSV } from '@sigx/lynx-keyboard';
import { useSafeAreaInsets } from '@sigx/lynx-safe-area';
import {
    createEmojiContext,
    EmojiPicker,
    EmojiStrip,
    EMOJI_CATEGORY_ICONS,
    enData,
    useEmojiContext,
    useKeyboardPanelReveal,
    type EmojiPickEvent,
    type EmojiTab,
} from '@sigx/lynx-emoji';
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
 * The drag-pill row under the input (`pt-1` + `h-1` + `pb-2`). Declared, not
 * guessed: the pill and the picker box together have to fill the panel
 * exactly, or the bottom-pinned tab bar lands off the visible edge.
 */
const PILL_H = 16;
/** The 🔍 / ⌫ chrome row at the top of the emoji panel. */
const CHROME_H = 44;
/** Everything the sheet's `handle` slot occupies while the panel is open. */
const HANDLE_H = INPUT_H + PILL_H + CHROME_H;
/** The search field row, and the one-row result strip above it. */
const SEARCH_ROW_H = 48;
const STRIP_H = 52;
/**
 * The sheet's floor while searching: input + strip + field. The sheet parks
 * at its floor and rides the keyboard on `liftSV`, so growing the floor is
 * all it takes to put exactly this much above the keyboard — the sheet
 * re-seats a parked floor by itself (#743).
 */
const SEARCH_FLOOR_H = INPUT_H + STRIP_H + SEARCH_ROW_H;
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

    // ONE emoji context for the screen — what `<EmojiProvider>` installs,
    // built here so this component can BOTH provide it (the picker below
    // adopts it instead of building a private one) and consume it: the
    // search strip needs `index.search` and `recents`, and sharing the
    // context is what keeps a pick from the strip in the picker's recents.
    const emoji = createEmojiContext(enData);
    defineProvide(useEmojiContext, () => emoji);

    // Keyboard lift as a SharedValue — the sheet rides above it (animated on
    // the MT). The keyboard-height MEMORY (the compact detent == the real
    // keyboard, inset add-back included) is the sheet's own job now: the
    // `{ keyboard: true }` detent tracks the BG-reactive lift inside
    // `@sigx/lynx-sheet` — the `rememberedKb` bookkeeping this screen used
    // to hand-roll (and its BG-vs-SV footgun) is gone.
    const kbLiftSV = useKeyboardLiftSV();
    // Still observed here, but only as the picker-warm trigger below.
    const kbLiftBG = useKeyboardLift();
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
    // The category tab row, pinned to the sheet's VISIBLE bottom edge. The
    // panel is laid out at its top detent and slid down, so the picker's
    // own bottom is off-screen at the compact detent — the sheet binds this
    // element to the inverse of that slide (main thread, every frame), which
    // is what keeps the tabs glued to the bottom through a drag.
    const tabsRef = useMainThreadRef<MainThread.Element | null>(null);
    // The sheet's SETTLED visible height (px), reported by `onRest`. Only
    // used for how far the grid may scroll — never for layout — so its
    // ~200 ms post-drag lag is invisible.
    const restH = signal(INPUT_H);

    const insertPick = (e: EmojiPickEvent): void => {
        ctrlBox.current?.insertText(e.glyph);
        draftEmpty.value = false;
    };

    // Setup scope, NOT a fresh arrow per render: a new function identity
    // would change the picker's props and re-render the whole grid on every
    // mode toggle. The theme getters are read at CALL time, so it still
    // follows a light/dark switch.
    const renderCategoryTab = (tab: EmojiTab, _glyph: string, active: boolean): JSXElement => (
        <LucideIcon
            name={EMOJI_CATEGORY_ICONS[tab === 'recents' ? 'recents' : tab.key] ?? 'circle'}
            size={22}
            color={active ? editorTheme.accentColor : editorTheme.placeholderColor}
        />
    );

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
    //
    // SEARCH shares the same machine. `close()` hands the keyboard back to
    // whichever field is meant to own it, so entering search is just
    // "close the panel, but focus the SEARCH box instead of the editor" —
    // no second state machine, and the dip-free settle timing comes along.
    const searching = signal(false);
    const query = signal('');
    let focusTarget: 'editor' | 'search' = 'editor';
    // NOTE: the search field is not focused programmatically — the user taps
    // it, as they would any search box. There is currently no way to focus an
    // intrinsic `<input>` from app code on Lynx: a main-thread
    // `invoke('focus')` throws ("node N does not have a LynxUI"), the BG
    // `INVOKE_UI_METHOD` op is swallowed by the host, and neither `focus` nor
    // `auto-focus` is honoured as an attribute — inside a snapshot template
    // (on by default) intrinsic attributes never reach the renderer's
    // patchProp at all, so no prop-driven fix can reach them either. Tracked
    // separately; WhatsApp's flow otherwise matches.

    const reveal = useKeyboardPanelReveal({
        blur: () => ctrlBox.current?.blur(),
        focus: () => {
            // Nothing to do for the search field — it auto-focuses on mount.
            if (focusTarget !== 'search') ctrlBox.current?.focus();
        },
    });
    const toggle = (): void => {
        if (reveal.mode() === 'open') { focusTarget = 'editor'; reveal.close(); }
        else reveal.open();
        Haptics.selection();
    };
    const backToKeyboard = (): void => {
        if (reveal.mode() === 'open') { focusTarget = 'editor'; reveal.close(); }
    };

    /** 🔍 — collapse the grid to a one-row strip and raise the keyboard. */
    const openSearch = (): void => {
        Haptics.selection();
        focusTarget = 'search';
        searching.value = true;
        if (reveal.mode() === 'open') reveal.close();
    };
    /** ← — back to the full emoji panel. */
    const exitSearch = (): void => {
        Haptics.selection();
        query.value = '';
        searching.value = false;
        focusTarget = 'editor';
        reveal.open();
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
        // Geometry is the sheet's job now. Declared, not computed:
        //  • floor    = the input row (px);
        //  • compact  = `{ keyboard: true }` — the sheet remembers the real
        //    keyboard height (BG-reactive) and adds the bottom inset back
        //    itself, so the emoji panel fills the exact keyboard rectangle
        //    (the math this screen used to hand-roll, footguns included);
        //  • full     = 92% of the screen.
        // `topOffset` caps every detent so the input never slides under the
        // header/safe area on short screens / landscape (BUG 3 — now a prop).
        const HEADER_H = 56;
        const topOffset = (insets.value.top ?? 0) + HEADER_H;
        const isSearching = searching.value;
        // Searching grows the FLOOR to [input + strip + field] and stops
        // there: the sheet parks at its floor and its `liftSV` puts that
        // block right on top of the keyboard, which is exactly WhatsApp's
        // search layout. No extra detents — `open` stays false throughout.
        const floorH = isSearching ? SEARCH_FLOOR_H : INPUT_H;
        const detents = isSearching
            ? [floorH]
            : [
                floorH,
                { keyboard: true, fallbackPx: DEFAULT_KB } as const,
                { fraction: 0.92 } as const,
            ];
        // Resolved full height, mirrored ONLY for the picker's fixed inner
        // height (the #606 zero-measure guard needs a px value): round the
        // fraction, clamp to the topOffset+bottomOffset cap — same as
        // resolveDetents (the sheet's bottom sits `insets.bottom` above the
        // true screen bottom, see the bottomOffset prop below).
        const bottomOffset = insets.value.bottom ?? 0;
        const fullH = Math.min(
            Math.round(screenH * 0.92),
            Math.max(1, Math.round(screenH - topOffset - bottomOffset)),
        );
        // The picker box fills the panel BELOW the handle — the panel's full
        // height, NOT the currently visible slice. Sizing it to the visible
        // slice instead would open a growing empty band under the grid for
        // the whole of an upward drag (the box only re-sizes once the drag
        // settles); at full height the grid always covers the visible area
        // and simply extends below the fold. What the fold costs — an
        // unreachable tail — is bought back with `gridBottomInset`.
        // Clamped: on a tiny screen (or Platform.pixelHeight 0 in non-Lynx
        // envs) this could go non-positive — never emit a zero/negative
        // height for the picker (see the #606 guard below).
        const pickerH = Math.max(1, fullH - HANDLE_H);
        // How much of the box is hidden below the visible edge. Without it
        // the native list scrolls to ITS OWN bottom and parks the last rows
        // off-screen — at the compact detent that stranded the tail of the
        // dataset (the flags section stopped ~8 rows early, #811).
        const gridBottomInset = Math.max(0, fullH - restH.value);
        // Search hits, or the recents as the zero-query state (WhatsApp).
        // `emoji.ready` gates the recents read the same way the picker does.
        const q = query.value.trim();
        const stripEmojis = !isSearching
            ? []
            : q !== ''
                ? emoji.index.search(q)
                : (emoji.ready.value ? emoji.recents.recents : []);
        const mode = reveal.mode();
        const engaged = mode !== 'closed';
        void revealSV;

        if (DEBUG_GEOM) {
            // eslint-disable-next-line no-console
            console.log('[composer-geom]', JSON.stringify({
                mode,
                kbLiftBG: kbLiftBG.value,
                inputH: INPUT_H,
                topOffset,
                fullH,
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
                    detents={detents}
                    topOffset={topOffset}
                    // The ancestor SafeAreaView pads the gesture bar, so the
                    // sheet's bottom edge sits `insets.bottom` above the true
                    // screen bottom — the cap must anchor there or the fully
                    // open sheet slides under the header by that amount.
                    bottomOffset={bottomOffset}
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
                    pinnedBottomRef={tabsRef}
                    onReveal={(sv) => { revealSV = sv; }}
                    onRest={(px) => { restH.value = px; }}
                    onSnap={(i) => { if (i === 0 && reveal.mode() === 'open') backToKeyboard(); }}
                    class="bg-base-100 border-t border-base-300"
                    slots={{
                        handle: () => (
                            // Input row FIRST, drag pill BELOW it (WhatsApp) — the
                            // input is the fixed top anchor, so entering emoji mode
                            // adds the pill+grid BELOW it and the input never jumps.
                            <view style={{ display: 'flex', flexDirection: 'column' }}>
                                <view ignore-focus={true}>
                                    <Row gap={8} align="flex-end" height={INPUT_H} class="px-2 py-2">
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
                                    <>
                                        <Col align="center" height={PILL_H} class="pt-1 pb-2">
                                            <view class="w-10 h-1 rounded-full bg-base-300" />
                                        </Col>
                                        {/* WhatsApp's panel chrome. It lives in the HANDLE
                                            slot (not the picker) so the panel's whole top
                                            area drags as one, and so the picker keeps its
                                            own `showSearch` off.
                                            No ⌫ button: WhatsApp has one, but the editor
                                            controller has no delete command and its offsets
                                            are unknown until the first selection event, so
                                            it would be a button that does nothing.
                                            `Row` takes TYPED props — lynx-zero drops a
                                            `style` object, so height/justify come through
                                            the props, not inline. */}
                                        <Row align="center" height={CHROME_H} class="px-2">
                                            <Button variant="ghost" circle onPress={openSearch}>
                                                <LucideIcon name="search" size={20} color={editorTheme.placeholderColor} />
                                            </Button>
                                        </Row>
                                    </>
                                )}
                                {isSearching && (
                                    <>
                                        {/* Results first, field below — the field sits on
                                            the keyboard and the strip reads above it. */}
                                        <view style={{ height: `${STRIP_H}px`, display: 'flex', justifyContent: 'center' }}>
                                            <EmojiStrip
                                                emojis={stripEmojis}
                                                cellSize={28}
                                                emptyLabel={query.value.trim() === '' ? 'Search for an emoji' : 'No emoji found'}
                                                onPick={insertPick}
                                            />
                                        </view>
                                        <Row gap={4} align="center" height={SEARCH_ROW_H} class="px-2">
                                            <Button variant="ghost" circle onPress={exitSearch}>
                                                <LucideIcon name="arrow-left" size={20} color={editorTheme.placeholderColor} />
                                            </Button>
                                            <input
                                                class="flex-1"
                                                type="text"
                                                confirm-type="search"
                                                placeholder="Search emoji"
                                                value={query.value}
                                                bindinput={(e: { detail?: { value?: unknown } }) => {
                                                    query.value = String(e?.detail?.value ?? '');
                                                }}
                                                // Native text widgets can't read CSS custom
                                                // properties (#225) — resolved hex, inline,
                                                // exactly like daisy's own `<Input>`.
                                                style={{
                                                    height: `${SEARCH_ROW_H - 12}px`,
                                                    color: editorTheme.textColor,
                                                    '-x-placeholder-color': editorTheme.placeholderColor,
                                                }}
                                            />
                                            {query.value !== '' && (
                                                <Button variant="ghost" circle onPress={() => { query.value = ''; }}>
                                                    <LucideIcon name="x" size={18} color={editorTheme.placeholderColor} />
                                                </Button>
                                            )}
                                        </Row>
                                    </>
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
                                    ? { height: `${pickerH}px`, display: 'flex', flexDirection: 'column' }
                                    : { height: '0px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
                            >
                                <view style={{ height: `${pickerH}px`, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                                    {pickerWarm.value && (
                                        <EmojiPicker
                                            // No `data` — the screen provides ONE shared
                                            // context above (so the search strip's picks
                                            // land in these recents).
                                            //
                                            // No search row either: search is the panel's
                                            // 🔍 button now, which collapses to a strip over
                                            // the keyboard instead of putting a focusable
                                            // field UNDER one.
                                            showSearch={false}
                                            onPick={insertPick}
                                            // WhatsApp's arrangement: the category row is the
                                            // picker's LAST row, and the sheet pins it to the
                                            // visible bottom edge via `tabsRef`.
                                            tabPlacement="bottom"
                                            tabBarRef={tabsRef}
                                            gridBottomInset={gridBottomInset}
                                            // Monochrome line icons instead of glyphs — the
                                            // name map is data from lynx-emoji, the art comes
                                            // from the app's own icon set.
                                            renderCategoryTab={renderCategoryTab}
                                            // Daisy skin — gives the sticky section headers their
                                            // opaque `bg-base-100`; without it the headless header
                                            // fallback is transparent and emojis scroll through it.
                                            // The bottom-tabs variant moves the divider to the
                                            // bar's top edge and makes it opaque (it paints over
                                            // the grid rows it overlaps).
                                            classes={emojiClassesBottomTabs}
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
