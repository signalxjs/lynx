import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, Heading, Row, ScrollView, Text, useMarkdownEditorTheme } from '@sigx/lynx-daisyui';
import {
    MarkdownEditor,
    MarkdownView,
    type MarkdownEditorController,
    type MarkdownEditorMode,
} from '@sigx/lynx-markdown';
import type { SelectionState } from '@sigx/lynx-richtext';

/**
 * Markdown editor lab — exercises the true-WYSIWYG `<MarkdownEditor>` built on
 * the native `<sigx-richtext>` element.
 *
 *  • Chat-style auto-grow: 1 line → 4 lines → internal scroll.
 *  • Formatting commands (toolbar lands in P2 — these buttons drive the same
 *    controller surface the toolbar will use). Active states come from the
 *    element's selection events.
 *  • The output contract is markdown: the live `<MarkdownView>` below renders
 *    exactly what `onChange` emitted.
 */
export const MarkdownEditorLab = component(() => {
    const editorTheme = useMarkdownEditorTheme();
    const markdown = signal('Hello **world** — edit me');
    const mode = signal<MarkdownEditorMode>('auto');
    const activeFormats = signal<string>('');
    let controller: MarkdownEditorController | null = null;

    const isActive = (format: string): boolean =>
        activeFormats.value.split(',').includes(format);

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Markdown editor lab" />
            <Col gap={16} padding={16}>
                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Heading level={4}>Editor ({mode.value})</Heading>

                            {/* Interim command strip — replaced by the real toolbar in P2.
                                ignore-focus: command taps must not blur the editor
                                (iOS folds the keyboard on any non-ignoring touch). */}
                            <view ignore-focus={true}>
                            <Row gap={6} wrap>
                                <Button size="sm" variant={isActive('bold') ? 'primary' : 'ghost'} outline={!isActive('bold')} onPress={() => controller?.toggleBold()}>B</Button>
                                <Button size="sm" variant={isActive('italic') ? 'primary' : 'ghost'} outline={!isActive('italic')} onPress={() => controller?.toggleItalic()}>I</Button>
                                <Button size="sm" variant={isActive('strike') ? 'primary' : 'ghost'} outline={!isActive('strike')} onPress={() => controller?.toggleStrike()}>S</Button>
                                <Button size="sm" variant={isActive('code') ? 'primary' : 'ghost'} outline={!isActive('code')} onPress={() => controller?.toggleCode()}>{'<>'}</Button>
                                <Button size="sm" variant="ghost" outline onPress={() => controller?.setHeading(1)}>H1</Button>
                                <Button size="sm" variant="ghost" outline onPress={() => controller?.setHeading(2)}>H2</Button>
                                <Button size="sm" variant="ghost" outline onPress={() => controller?.setHeading(0)}>¶</Button>
                                <Button size="sm" variant="ghost" outline onPress={() => controller?.clear()}>Clear</Button>
                            </Row>
                            </view>

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
                                    onSelectionChange={(sel: SelectionState) => {
                                        activeFormats.value = sel.activeFormats.join(',');
                                    }}
                                    controllerRef={(ctrl) => {
                                        controller = ctrl;
                                    }}
                                />
                            </view>

                            <Row gap={6}>
                                <Button size="sm" variant={mode.value === 'auto' ? 'primary' : 'ghost'} outline={mode.value !== 'auto'} onPress={() => { mode.value = 'auto'; }}>auto</Button>
                                <Button size="sm" variant={mode.value === 'fixed' ? 'primary' : 'ghost'} outline={mode.value !== 'fixed'} onPress={() => { mode.value = 'fixed'; }}>fixed</Button>
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
