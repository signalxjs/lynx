import { component } from '@sigx/lynx';
import { Col, Heading, Row, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Heading — the six semantic levels, each a fixed size/weight pairing off the
 * text ramp (level 1 → text-3xl/bold … level 6 → text-sm/semibold).
 */

const LEVELS = [1, 2, 3, 4, 5, 6] as const;

// The token each level resolves to — labels the comparison row.
const LEVEL_TOKENS: Record<(typeof LEVELS)[number], string> = {
    1: 'text-3xl · bold',
    2: 'text-2xl · bold',
    3: 'text-xl · semibold',
    4: 'text-lg · semibold',
    5: 'text-base · semibold',
    6: 'text-sm · semibold',
};

export const headingDemo: DaisyComponentDemo = {
    id: 'heading',
    title: 'Heading',
    description: 'The six semantic levels, each a fixed size/weight off the ramp',
    icon: { set: 'lucide', name: 'heading' },
    sections: [
        {
            title: 'Levels',
            Demo: component(() => () => (
                <Col gap={10}>
                    {LEVELS.map((level) => (
                        <Heading key={level} level={level}>Heading {level}</Heading>
                    ))}
                </Col>
            )),
        },
        {
            title: 'Tokens',
            note: 'each level maps to a fixed size/weight pairing',
            Demo: component(() => () => (
                <Col gap={8}>
                    {LEVELS.map((level) => (
                        <Row key={level} align="center" justify="space-between" gap={12}>
                            <Heading level={level}>Aa</Heading>
                            <Text class="opacity-50 text-sm">{LEVEL_TOKENS[level]}</Text>
                        </Row>
                    ))}
                </Col>
            )),
        },
        {
            title: 'In context',
            Demo: component(() => () => (
                <Col gap={6}>
                    <Heading level={2}>Section title</Heading>
                    <Text class="opacity-70">
                        A heading paired with body text shows the size contrast the
                        levels are tuned for — the body stays at the base ramp size.
                    </Text>
                    <Heading level={4}>Subsection</Heading>
                    <Text size="sm" class="opacity-60">Supporting detail under a smaller heading.</Text>
                </Col>
            )),
        },
    ],
};
