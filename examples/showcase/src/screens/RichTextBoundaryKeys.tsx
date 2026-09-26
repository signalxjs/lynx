import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, Heading, Row, ScrollView, Text } from '@sigx/lynx-daisyui';
import { useMarkdownEditorTheme } from '@sigx/lynx-daisyui/markdown';
import { RichTextInput, RichTextMethods, type RichDoc, type RichTextBoundaryKeyEvent, type RichTextHandle } from '@sigx/lynx-richtext';

/**
 * `<sigx-richtext boundary-keys>` — the single-block mode block editors run
 * the element in. The keys that cross the block's edge (Return, Backspace
 * at 0, forward delete at the end, arrows off the first/last line, Tab,
 * Escape) are reported through `onBoundaryKey` and NOT acted on; everything
 * else stays native. Press them and watch the log: Return never inserts a
 * newline here.
 */
export const RichTextBoundaryKeysScreen = component(() => {
    const editorTheme = useMarkdownEditorTheme();
    // One reactive object: an array signal is a deep proxy of the array itself.
    const state = signal({ lines: [] as string[], text: 'one block', height: 44 });
    const push = (line: string): void => {
        state.lines = [line, ...state.lines].slice(0, 12);
    };
    let el: RichTextHandle = null;

    const initial: RichDoc = {
        text: state.text,
        spans: [{ start: 4, end: 9, type: 'bold' }],
        blocks: [{ start: 0, end: state.text.length, type: 'paragraph' }],
        v: 0,
    };

    const onBoundaryKey = (e: RichTextBoundaryKeyEvent['detail']): void => {
        push(`${e.key} @ ${e.start}${e.end !== e.start ? `–${e.end}` : ''}`);
    };

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Rich text: boundary keys" />
            <Col gap={16} padding={16}>
                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Heading level={4}>Single-block field</Heading>
                            <Text size="sm" class="opacity-70">
                                Return, Backspace at the start, Delete at the end, arrows at the edges, Tab and Escape are reported below instead of acted on.
                            </Text>
                            <view class="border border-base-300 rounded-lg px-2">
                                <RichTextInput
                                    value={initial}
                                    boundaryKeys
                                    placeholder="Type, then press Return…"
                                    minHeight={44}
                                    maxHeight={120}
                                    style={{ height: Math.max(44, Math.min(state.height, 120)) }}
                                    onHeightChange={(h) => {
                                        state.height = h;
                                    }}
                                    fontSize={16}
                                    textColor={editorTheme.textColor}
                                    accentColor={editorTheme.accentColor}
                                    placeholderColor={editorTheme.placeholderColor}
                                    onElement={(handle) => {
                                        el = handle;
                                    }}
                                    onChange={(doc) => {
                                        state.text = doc.text;
                                    }}
                                    onBoundaryKey={onBoundaryKey}
                                    onFocus={() => push('focus')}
                                    onBlur={() => push('blur')}
                                />
                            </view>
                            <Row gap={6}>
                                <Button size="sm" variant="outline" onPress={() => RichTextMethods.setSelectionRange(el, 0, 0)}>caret → start</Button>
                                <Button size="sm" variant="outline" onPress={() => RichTextMethods.setSelectionRange(el, state.text.length, state.text.length)}>caret → end</Button>
                                <Button size="sm" variant="outline" onPress={() => { state.lines = []; }}>clear log</Button>
                            </Row>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={4}>
                            <Heading level={4}>Text</Heading>
                            <Text size="sm" class="font-mono opacity-70">{JSON.stringify(state.text)}</Text>
                            <Heading level={4}>Boundary keys (newest first)</Heading>
                            {state.lines.length === 0 ? <Text size="sm" class="opacity-50">(none yet)</Text> : null}
                            {state.lines.map((line: string, i: number) => (
                                <Text key={`${i}-${line}`} size="sm" class="font-mono">{line}</Text>
                            ))}
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
