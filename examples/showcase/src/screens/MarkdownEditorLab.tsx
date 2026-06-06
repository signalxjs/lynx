import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, Heading, Row, ScrollView, Text, useMarkdownEditorTheme } from '@sigx/lynx-daisyui';
import {
    createMentionPlugin,
    MarkdownEditor,
    MarkdownView,
    mentionSyntax,
    type MarkdownEditorController,
    type MarkdownEditorMode,
    type MarkdownEditorPlugin,
    type MentionCandidate,
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

/**
 * Mention demo (#157): type `@` for user suggestions; selecting inserts a
 * native chip (one U+FFFC backed by an attachment pill in the field) and the
 * markdown output carries `@[label](id)`. The preview renders mentions via
 * `components.extension.mention`.
 */
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

const previewExtensions = [emojiSyntax, mentionSyntax];
const previewComponents = {
    extension: {
        emoji: ({ attrs }: { attrs: Record<string, string> }) =>
            EMOJI.find((e) => e.id === attrs.name)?.glyph ?? `:${attrs.name}:`,
        mention: ({ attrs }: { attrs: Record<string, string> }) => (
            <text style={{ color: '#3478f6', fontWeight: 600 }}>@{attrs.label}</text>
        ),
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
 *  • Plugin demos: type `:` for emoji suggestions (text replacement) and
 *    `@` for mentions (native chips via insertChip, #157); the preview
 *    renders both via parser inline extensions.
 */
export const MarkdownEditorLab = component(() => {
    const editorTheme = useMarkdownEditorTheme();
    const markdown = signal('Hello **world** — type `:` for emoji :rocket: or `@` to mention @[Andy](u1)');
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
                                    plugins={[emojiPlugin, mentionPlugin]}
                                    fullscreenClass="bg-base-100"
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
                                {/* Controller-driven overlay — the same mounted
                                    editor restyles to absolute-inset, so the
                                    document/selection survive (close via ✕). */}
                                <Button size="sm" variant="ghost" outline onPress={() => controller?.openFullscreen()}>fullscreen</Button>
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
                            <Heading level={4}>Rendered (MarkdownView + emoji/mention extensions)</Heading>
                            <MarkdownView
                                value={markdown.value}
                                extensions={previewExtensions}
                                components={previewComponents}
                            />
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
