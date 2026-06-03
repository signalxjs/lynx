import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, Heading, Row, ScrollView, Text, markdownComponents } from '@sigx/lynx-daisyui';
import { MarkdownView, createMarkdownStream } from '@sigx/lynx-markdown';

/**
 * Markdown lab — exercises `@sigx/lynx-markdown`'s SignalX-native renderer.
 *
 *  • The static section renders a document covering the full feature set
 *    (headings, emphasis, lists, task lists, code, blockquote, table, links).
 *  • The streaming section drives `createMarkdownStream()` token-by-token to
 *    demonstrate that finalized blocks don't reflow/flicker while new tokens
 *    arrive — the property that matters for AI chat output.
 */

const SAMPLE = `# Markdown lab

A **native** renderer with _streaming_ and ~~no~~ full GFM support.

- bullet one
- bullet two with \`inline code\`
  - nested item

1. first
2. second

- [x] shipped
- [ ] todo

> A blockquote with a [link](https://signalx.dev).

\`\`\`ts
const greet = (name: string) => \`hi \${name}\`;
\`\`\`

| Feature | State |
| :------ | :---: |
| Tables  | yes   |
| Stream  | yes   |
`;

/** Split the sample into small chunks to simulate AI token streaming. */
function chunk(text: string, size = 4): string[] {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
    return out;
}

export const MarkdownLab = component(() => {
    const stream = createMarkdownStream({ flushIntervalMs: 16 });
    const streaming = signal(false);

    const play = (): void => {
        stream.reset();
        streaming.value = true;
        const chunks = chunk(SAMPLE);
        let i = 0;
        const tick = (): void => {
            if (i >= chunks.length) {
                stream.done();
                streaming.value = false;
                return;
            }
            stream.append(chunks[i++]);
            setTimeout(tick, 24);
        };
        tick();
    };

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Markdown lab" />
            <Col gap={16} padding={16}>
                    <Card bordered>
                        <Card.Body>
                            <Col gap={8}>
                                <Heading level={4}>Streaming</Heading>
                                <Text class="opacity-60 text-sm">
                                    Drives createMarkdownStream() in small chunks. Completed
                                    blocks stay put as new tokens arrive.
                                </Text>
                                <Row gap={8}>
                                    <Button
                                        variant="primary"
                                        disabled={streaming.value}
                                        onPress={play}
                                    >
                                        {streaming.value ? 'Streaming…' : 'Play stream'}
                                    </Button>
                                    <Button variant="ghost" outline onPress={() => stream.reset()}>
                                        Reset
                                    </Button>
                                </Row>
                                <MarkdownView value={stream.value.value} components={markdownComponents} />
                            </Col>
                        </Card.Body>
                    </Card>

                    <Card bordered>
                        <Card.Body>
                            <Col gap={8}>
                                <Heading level={4}>Static render (daisyUI)</Heading>
                                <MarkdownView value={SAMPLE} components={markdownComponents} />
                            </Col>
                        </Card.Body>
                    </Card>

                    <Card bordered>
                        <Card.Body>
                            <Col gap={8}>
                                <Heading level={4}>Static render (generic defaults)</Heading>
                                <MarkdownView value={SAMPLE} />
                            </Col>
                        </Card.Body>
                    </Card>
                </Col>
        </ScrollView>
    );
});
