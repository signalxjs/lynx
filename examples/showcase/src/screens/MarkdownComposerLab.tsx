import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import {
    Button,
    Col,
    Row,
    ScrollView,
    markdownComponents,
    useMarkdownEditorTheme,
} from '@sigx/lynx-daisyui';
import { KeyboardAvoidingView, KeyboardStickyView } from '@sigx/lynx-keyboard';
import { MarkdownEditor, MarkdownView, type MarkdownEditorController } from '@sigx/lynx-markdown';
import type { SelectionState } from '@sigx/lynx-richtext';

/**
 * Markdown composer lab — the full chat-composer shape, assembled from the
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
 *
 * Presented as a modal (same caveat as the Keyboard lab: the lift math assumes
 * the bar sits directly above the bottom safe-area inset — on a tab screen,
 * compensate with `offset={tabBarHeight}`).
 */

const SEED: Array<{ own: boolean; md: string }> = [
    { own: false, md: 'This composer is a **MarkdownEditor** riding a `KeyboardStickyView`.' },
    { own: true, md: 'So the toolbar travels with the keyboard?' },
    { own: false, md: 'Exactly — and what you send renders through **MarkdownView**:\n\n- lists\n- `code`\n- ~~everything~~' },
];

export const MarkdownComposerLab = component(() => {
    const editorTheme = useMarkdownEditorTheme();
    const messages = signal<Array<{ own: boolean; md: string }>>([...SEED]);
    const activeFormats = signal<string>('');
    const draftEmpty = signal(true);
    let controller: MarkdownEditorController | null = null;

    const isActive = (format: string): boolean =>
        activeFormats.value.split(',').includes(format);

    const send = (): void => {
        const md = controller?.getMarkdown().trim() ?? '';
        if (!md) return;
        messages.$set([...messages, { own: true, md }]);
        controller?.clear();
        draftEmpty.value = true;
    };

    const formatButton = (label: string, format: string, run: () => void) => (
        <Button
            size="sm"
            variant={isActive(format) ? 'primary' : 'ghost'}
            square
            onPress={run}
        >
            {label}
        </Button>
    );

    return () => (
        <Col class="flex-fill bg-base-100">
            <Screen title="Markdown composer" />
            <KeyboardAvoidingView behavior="padding">
                <ScrollView class="flex-1">
                    <Col gap={8} padding={12}>
                        {messages.map((m) => (
                            <Row justify={m.own ? 'flex-end' : 'flex-start'} class="px-1">
                                <view class={`rounded-2xl px-3 py-2 max-w-[85%] ${m.own ? 'bg-primary' : 'bg-base-200'}`}>
                                    <MarkdownView value={m.md} components={markdownComponents} />
                                </view>
                            </Row>
                        ))}
                    </Col>
                </ScrollView>
            </KeyboardAvoidingView>

            <KeyboardStickyView>
                <Col class="border-t border-base-300 bg-base-100">
                    {/* Formatting toolbar — the P2 toolbar preview, with live
                        active states from the element's selection events. */}
                    <Row gap={4} class="px-2 pt-2">
                        {formatButton('B', 'bold', () => controller?.toggleBold())}
                        {formatButton('I', 'italic', () => controller?.toggleItalic())}
                        {formatButton('S', 'strike', () => controller?.toggleStrike())}
                        {formatButton('</>', 'code', () => controller?.toggleCode())}
                    </Row>
                    <Row gap={8} align="flex-end" class="p-2">
                        <view class="flex-1 border border-base-300 rounded-2xl px-2">
                            <MarkdownEditor
                                placeholder="Message…"
                                minLines={1}
                                maxLines={4}
                                confirmType="send"
                                textColor={editorTheme.textColor}
                                accentColor={editorTheme.accentColor}
                                placeholderColor={editorTheme.placeholderColor}
                                onChange={(md) => {
                                    draftEmpty.value = md.trim() === '';
                                }}
                                onSelectionChange={(sel: SelectionState) => {
                                    activeFormats.value = sel.activeFormats.join(',');
                                }}
                                controllerRef={(ctrl) => {
                                    controller = ctrl;
                                }}
                            />
                        </view>
                        <Button variant="primary" disabled={draftEmpty.value} onPress={send}>
                            Send
                        </Button>
                    </Row>
                </Col>
            </KeyboardStickyView>
        </Col>
    );
});
