import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, EmojiPickerSheet, Heading, Row, ScrollView, Text, useMarkdownEditorTheme } from '@sigx/lynx-daisyui';
import {
    createMentionPlugin,
    MarkdownEditor,
    MarkdownView,
    mentionSyntax,
    type MarkdownEditorController,
    type MarkdownEditorMode,
    type MentionCandidate,
} from '@sigx/lynx-markdown';
import { enData } from '@sigx/lynx-emoji';
import { createEmojiPlugin, createEmojiSyntax, emojiExtensionComponent } from '@sigx/lynx-emoji/markdown';

/**
 * Emoji plugin (`@sigx/lynx-emoji/markdown`) over the full ~1900-emoji
 * dataset:
 *
 *  • Trigger: typing `:` opens the suggestion popup with ranked search
 *    (shortcodes, names, keywords); selecting inserts the glyph itself.
 *  • Parser extension (`createEmojiSyntax`): `:rocket:` in markdown source
 *    previews as 🚀 via `components.extension.emoji`. Unknown shortcodes and
 *    partial tails (`:sm`) stay literal — streaming-safe.
 *  • Toolbar: the plugin's 😊 item opens the daisy `EmojiPickerSheet`;
 *    picks insert at the caret via `controller.insertText`.
 */
const emojiSyntax = createEmojiSyntax();

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
        emoji: emojiExtensionComponent,
        mention: ({ attrs }: { attrs: Record<string, string> }) => (
            <text style={{ color: '#3478f6', fontWeight: 600 }}>@{attrs.label}</text>
        ),
    },
};

/**
 * Markdown editor — exercises the true-WYSIWYG `<MarkdownEditor>` built on
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
export const MarkdownEditorScreen = component(() => {
    const editorTheme = useMarkdownEditorTheme();
    const markdown = signal('Hello **world** — type `:` for emoji :rocket: or `@` to mention @[Andy](u1)');
    const mode = signal<MarkdownEditorMode>('auto');
    const emojiSheetOpen = signal(false);
    let controller: MarkdownEditorController | null = null;

    // Per-instance so the toolbar's 😊 item can flip this screen's sheet.
    const emojiPlugin = createEmojiPlugin({
        onPickerRequest: () => { emojiSheetOpen.value = true; },
    });

    return () => (
        <view class="flex-fill" style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Markdown editor" />
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
                                <Button size="sm" color={mode.value === 'auto' ? 'primary' : undefined} variant={mode.value === 'auto' ? undefined : 'outline'} onPress={() => { mode.value = 'auto'; }}>auto</Button>
                                <Button size="sm" color={mode.value === 'fixed' ? 'primary' : undefined} variant={mode.value === 'fixed' ? undefined : 'outline'} onPress={() => { mode.value = 'fixed'; }}>fixed</Button>
                                {/* Controller-driven overlay — the same mounted
                                    editor restyles to absolute-inset, so the
                                    document/selection survive (close via ✕). */}
                                <Button size="sm" variant="outline" onPress={() => controller?.openFullscreen()}>fullscreen</Button>
                                <Button size="sm" variant="outline" onPress={() => controller?.clear()}>Clear</Button>
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
        {/* Toolbar 😊 → sheet → insert at caret. */}
        <EmojiPickerSheet
            open={emojiSheetOpen.value}
            data={enData}
            onPick={({ glyph }) => controller?.insertText(glyph)}
            onClose={() => { emojiSheetOpen.value = false; }}
        />
        </view>
    );
});
