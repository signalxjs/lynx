import { component } from '@sigx/lynx';
import { Col, Row, Text } from '@sigx/lynx-heroui';
import type { HeroComponentDemo } from '../registry.js';

/**
 * Text — hero type ramp over the shared `--text-*` tokens, weight ramp,
 * semantic colors, and native selection.
 */
export const textDemo: HeroComponentDemo = {
    id: 'text',
    title: 'Text',
    description: 'Type ramp, weights, semantic colors, selectable',
    icon: { set: 'lucide', name: 'type' },
    sections: [
        {
            title: 'Sizes',
            note: 'The hero classes read the shared --text-* tokens, so fontScale applies',
            Demo: component(() => () => (
                <Col gap={4}>
                    <Text size="xs">xs — the quick brown fox</Text>
                    <Text size="sm">sm — the quick brown fox</Text>
                    <Text size="base">base — the quick brown fox</Text>
                    <Text size="lg">lg — the quick brown fox</Text>
                    <Text size="xl">xl — the quick brown fox</Text>
                    <Text size="2xl">2xl — the quick brown fox</Text>
                    <Text size="3xl">3xl — the quick brown fox</Text>
                </Col>
            )),
        },
        {
            title: 'Weights',
            Demo: component(() => () => (
                <Col gap={4}>
                    <Text weight="light">light</Text>
                    <Text weight="normal">normal</Text>
                    <Text weight="medium">medium</Text>
                    <Text weight="semibold">semibold</Text>
                    <Text weight="bold">bold</Text>
                </Col>
            )),
        },
        {
            title: 'Colors',
            Demo: component(() => () => (
                <Row gap={12} class="flex-wrap">
                    <Text color="primary">primary</Text>
                    <Text color="secondary">secondary</Text>
                    <Text color="success">success</Text>
                    <Text color="warning">warning</Text>
                    <Text color="error">error</Text>
                </Row>
            )),
        },
        {
            title: 'Selectable',
            note: 'Long-press to select (sets text-selection + flatten=false)',
            Demo: component(() => () => (
                <Text selectable>This paragraph can be selected and copied natively.</Text>
            )),
        },
    ],
};
