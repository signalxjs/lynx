import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, Heading, Row, ScrollView, Text, useMarkdownEditorTheme } from '@sigx/lynx-daisyui';
import {
    MarkdownEditor,
    MarkdownView,
    type MarkdownEditorController,
    type MarkdownEditorMode,
    type MarkdownEditorPlugin,
    type ParserInlineExtension,
} from '@sigx/lynx-markdown';

/**
 * Minimal P3 plugin demo: `:emoji:` shortcodes, text-only (no native chips —
 * those are the mention plugin, #157).
 *
 *  • Parser extension: `:smile:` → an `emoji` extension node. `match` returns
 *    null on a partial tail (`:sm`), so streaming text never half-renders.
 *  • Trigger: typing `:` opens the suggestion popup against a static list;
 *    selecting replaces the typed query with the shortcode text.
 *  • Preview renderer: the MarkdownView below shows the actual glyph via
 *    `components.extension.emoji`.
 */
const EMOJI: Array<{ id: string; glyph: string }> = [
    { id: 'smile', glyph: '😄' },
    { id: 'heart', glyph: '❤️' },
    { id: 'rocket', glyph: '🚀' },
    { id: 'tada', glyph: '🎉' },
    { id: 'thinking', glyph: '🤔' },
];

const emojiSyntax: ParserInlineExtension = {
    name: 'emoji',
    triggerChars: [':'],
    match(text, pos) {
        const m = /^:([a-z0-9_+-]+):/.exec(text.slice(pos));
        if (!m || !EMOJI.some((e) => e.id === m[1])) return null;
        return {
            node: { type: 'extension', name: 'emoji', attrs: { name: m[1] }, raw: m[0] },
            end: pos + m[0].length,
        };
    },
};

const emojiPlugin: MarkdownEditorPlugin = {
    name: 'emoji',
    trigger: {
        char: ':',
        onQuery: (q) => EMOJI
            .filter((e) => e.id.startsWith(q.toLowerCase()))
            .map((e) => ({ id: e.id, label: `${e.glyph}  :${e.id}:` })),
        onSelect: (item, api) => api.replaceQuery(`:${item.id}: `),
    },
};

const emojiComponents = {
    extension: {
        emoji: ({ attrs }: { attrs: Record<string, string> }) =>
            EMOJI.find((e) => e.id === attrs.name)?.glyph ?? `:${attrs.name}:`,
    },
};

/**
 * Markdown editor lab — exercises the true-WYSIWYG `<MarkdownEditor>` built on
 * the native `<sigx-richtext>` element.
 *
 *  • Chat-style auto-grow: 1 line → 4 lines → internal scroll.
 *  • The built-in `toolbar` (neutral default items + generic rendering) sits
 *    below the input; a Clear button rides next to the mode switcher.
 *  • The output contract is markdown: the live `<MarkdownView>` below renders
 *    exactly what `onChange` emitted.
 *  • Plugin demo: type `:` for emoji suggestions (the P3 trigger/popup API);
 *    the preview renders shortcodes as glyphs via a parser inline extension.
 */
export const MarkdownEditorLab = component(() => {
    const editorTheme = useMarkdownEditorTheme();
    const markdown = signal('Hello **world** — edit me, or type `:` for emoji :rocket:');
    const mode = signal<MarkdownEditorMode>('auto');
    let controller: MarkdownEditorController | null = null;

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Markdown editor lab" />
            <Col gap={16} padding={16}>
                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Heading level={4}>Editor ({mode.value})</Heading>

                            <view class="border border-base-300 rounded-lg px-2">
                                <MarkdownEditor
                                    value={markdown.value}
                                    placeholder="Write some markdown…"
                                    minLines={1}
                                    maxLines={4}
                                    mode={mode.value as MarkdownEditorMode}
                                    confirmType="send"
                                    textColor={editorTheme.textColor}
                                    accentColor={editorTheme.accentColor}
                                    placeholderColor={editorTheme.placeholderColor}
                                    plugins={[emojiPlugin]}
                                    onChange={(md) => {
                                        markdown.value = md;
                                    }}
                                    controllerRef={(ctrl) => {
                                        controller = ctrl;
                                    }}
                                    toolbar
                                />
                            </view>

                            <Row gap={6}>
                                <Button size="sm" variant={mode.value === 'auto' ? 'primary' : 'ghost'} outline={mode.value !== 'auto'} onPress={() => { mode.value = 'auto'; }}>auto</Button>
                                <Button size="sm" variant={mode.value === 'fixed' ? 'primary' : 'ghost'} outline={mode.value !== 'fixed'} onPress={() => { mode.value = 'fixed'; }}>fixed</Button>
                                <Button size="sm" variant="ghost" outline onPress={() => controller?.clear()}>Clear</Button>
                            </Row>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Heading level={4}>Markdown output</Heading>
                            <Text size="sm" class="font-mono opacity-70">{markdown.value || '(empty)'}</Text>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Heading level={4}>Rendered (MarkdownView + emoji extension)</Heading>
                            <MarkdownView
                                value={markdown.value}
                                extensions={[emojiSyntax]}
                                components={emojiComponents}
                            />
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
