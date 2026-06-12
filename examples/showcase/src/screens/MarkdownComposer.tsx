import { component, signal, pushOp, scheduleFlush, OP } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import {
    Button,
    Col,
    EditorToolbar,
    Row,
    markdownComponents,
    useMarkdownEditorTheme,
} from '@sigx/lynx-daisyui';
import { KeyboardAvoidingView, KeyboardStickyView } from '@sigx/lynx-keyboard';
import {
    createMentionPlugin,
    MarkdownView,
    mentionSyntax,
    type MentionCandidate,
} from '@sigx/lynx-markdown';
import { MarkdownEditor, type MarkdownEditorController } from '@sigx/lynx-markdown/editor';
import type { SelectionState } from '@sigx/lynx-richtext';

/**
 * Markdown composer — the full chat-composer shape, assembled from the
 * pieces this repo now ships:
 *
 *  • `<MarkdownEditor>` as the message input: true WYSIWYG (bold is bold in
 *    the field), 1 → 4 lines auto-grow, themed via `useMarkdownEditorTheme()`.
 *  • A formatting toolbar with live active states, riding the soft keyboard's
 *    top edge inside `<KeyboardStickyView>` together with the composer.
 *  • Sent messages render their markdown with `<MarkdownView>` + the daisyUI
 *    `markdownComponents`.
 *  • The message list sits in `<KeyboardAvoidingView behavior="padding">` so
 *    nothing hides behind the IME.
 *  • Type `@` for mentions: the suggestion popup is themed via
 *    `useMarkdownEditorTheme().suggestionPopup` and — because the composer is
 *    docked at the bottom — `SuggestionPopup` flips it *up* above the caret.
 *    Sent messages render their `@[label](id)` chips via `mentionSyntax`.
 *
 * Presented as a modal (same caveat as the Keyboard demo: the lift math assumes
 * the bar sits directly above the bottom safe-area inset — on a tab screen,
 * compensate with `offset={tabBarHeight}`).
 */

const SEED: Array<{ own: boolean; md: string }> = [
    { own: false, md: 'This composer is a **MarkdownEditor** riding a `KeyboardStickyView`.' },
    { own: true, md: 'So the toolbar travels with the keyboard?' },
    { own: false, md: 'Exactly — type `@` to mention @[Andy](u1), and what you send renders through **MarkdownView**:\n\n- lists\n- `code`\n- ~~everything~~' },
];

const USERS: MentionCandidate[] = [
    { id: 'u1', label: 'Andy', kind: 'user' },
    { id: 'u2', label: 'Bea', kind: 'user' },
    { id: 'u3', label: 'Carol', kind: 'user' },
    { id: 'u4', label: 'Dimitri', kind: 'user' },
    { id: 'team-core', label: 'core-team', kind: 'team' },
];

const mentionPlugin = createMentionPlugin({
    search: (q) => USERS.filter((u) => u.label.toLowerCase().startsWith(q.toLowerCase())),
});

// Sent bubbles carry `@[label](id)`; render the chip via the mention
// extension. A themed pill (its own `base-100` surface) so it follows the
// active theme and stays legible inside both the `bg-primary` (own) and
// `bg-base-200` (other) bubbles.
const bubbleComponents = {
    ...markdownComponents,
    extension: {
        ...markdownComponents.extension,
        mention: ({ attrs }: { attrs: Record<string, string> }) => (
            <text class="bg-base-100 text-primary rounded px-1 font-semibold">@{attrs.label}</text>
        ),
    },
};

export const MarkdownComposerScreen = component(() => {
    const editorTheme = useMarkdownEditorTheme();
    const messages = signal<Array<{ own: boolean; md: string }>>([...SEED]);
    const selBox = signal<{ current: SelectionState | null }>({ current: null });
    const ctrlBox = signal<{ current: MarkdownEditorController | null }>({ current: null });
    const draftEmpty = signal(true);

    let scrollEl: { id: number } | null = null;
    const scrollToBottom = (): void => {
        if (!scrollEl) return;
        // Defer one tick so layout includes the just-appended bubble.
        setTimeout(() => {
            if (!scrollEl) return;
            pushOp(OP.INVOKE_UI_METHOD, scrollEl.id, 'scrollTo', { offset: 100000, smooth: true });
            scheduleFlush();
        }, 60);
    };

    const send = (): void => {
        const md = ctrlBox.current?.getMarkdown().trim() ?? '';
        if (!md) return;
        messages.$set([...messages, { own: true, md }]);
        ctrlBox.current?.clear();
        draftEmpty.value = true;
        scrollToBottom();
    };

    return () => (
        <Col class="flex-fill bg-base-100">
            <Screen title="Markdown composer" />
            <KeyboardAvoidingView behavior="padding">
                <scroll-view class="flex-1" scroll-orientation="vertical" ref={(el: { id: number }) => { scrollEl = el; }}>
                    <Col gap={8} padding={12}>
                        {messages.map((m) => (
                            <Row justify={m.own ? 'flex-end' : 'flex-start'} class="px-1">
                                <view class={`rounded-2xl px-3 py-2 max-w-[85%] ${m.own ? 'bg-primary' : 'bg-base-200'}`}>
                                    <MarkdownView value={m.md} extensions={[mentionSyntax]} components={bubbleComponents} />
                                </view>
                            </Row>
                        ))}
                    </Col>
                </scroll-view>
            </KeyboardAvoidingView>

            <KeyboardStickyView>
                {/* ignore-focus (inherited by every child): taps on the bar's
                    chrome — toolbar buttons, Send — must not blur the editor,
                    or iOS folds the keyboard before the command can apply. */}
                <view ignore-focus={true}>
                <Col class="border-t border-base-300 bg-base-100">
                    <Row gap={8} align="flex-end" class="px-2 pt-2">
                        <view class="flex-1 border border-base-300 rounded-2xl px-2">
                            <MarkdownEditor
                                placeholder="Message…"
                                minLines={1}
                                maxLines={4}
                                confirmType="send"
                                textColor={editorTheme.textColor}
                                accentColor={editorTheme.accentColor}
                                placeholderColor={editorTheme.placeholderColor}
                                suggestionPopup={editorTheme.suggestionPopup}
                                plugins={[mentionPlugin]}
                                onChange={(md) => {
                                    draftEmpty.value = md.trim() === '';
                                }}
                                onSelectionChange={(sel: SelectionState) => {
                                    selBox.current = sel;
                                }}
                                controllerRef={(ctrl) => {
                                    ctrlBox.current = ctrl;
                                }}
                            />
                        </view>
                        <Button color="primary" disabled={draftEmpty.value} onPress={send}>
                            Send
                        </Button>
                    </Row>
                    {/* daisyUI EditorToolbar — below the input (the common
                        placement: iOS's selection handles + edit menu pop up
                        *above* the selection). Same ToolbarItem contract as
                        the generic toolbar; active states from selection. */}
                    <EditorToolbar
                        controller={ctrlBox.current}
                        selection={selBox.current}
                        class="px-2 pb-2"
                    />
                </Col>
                </view>
            </KeyboardStickyView>
        </Col>
    );
});
