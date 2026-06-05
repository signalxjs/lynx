import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, Heading, Row, ScrollView, Text, useMarkdownEditorTheme } from '@sigx/lynx-daisyui';
import {
    MarkdownEditor,
    MarkdownView,
    type MarkdownEditorController,
    type MarkdownEditorMode,
} from '@sigx/lynx-markdown';

/**
 * Markdown editor lab — exercises the true-WYSIWYG `<MarkdownEditor>` built on
 * the native `<sigx-richtext>` element.
 *
 *  • Chat-style auto-grow: 1 line → 4 lines → internal scroll.
 *  • The built-in `toolbar` (neutral default items + generic rendering) sits
 *    below the input; a Clear button rides next to the mode switcher.
 *  • The output contract is markdown: the live `<MarkdownView>` below renders
 *    exactly what `onChange` emitted.
 */
export const MarkdownEditorLab = component(() => {
    const editorTheme = useMarkdownEditorTheme();
    const markdown = signal('Hello **world** — edit me');
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
                            <Heading level={4}>Rendered (MarkdownView)</Heading>
                            <MarkdownView value={markdown.value} />
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
