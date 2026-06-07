import { component } from '@sigx/lynx';
import { Button, Card, Col, Heading, Row, Text } from '@sigx/lynx-heroui';
import type { HeroComponentDemo } from '../registry.js';

/** Card — content surface with hero roundness; flat by default, bordered opt-in. */
export const cardDemo: HeroComponentDemo = {
    id: 'card',
    title: 'Card',
    description: 'Content surface with hero roundness — flat and bordered',
    icon: { set: 'lucide', name: 'square' },
    sections: [
        {
            title: 'Basic',
            Demo: component(() => () => (
                <Card>
                    <Card.Body>
                        <Heading level={4}>Hero card</Heading>
                        <Text size="sm">
                            Colors come from the hero palette through the same
                            --color-* contract daisy uses; the larger roundness is
                            hero’s theme-level radius override.
                        </Text>
                    </Card.Body>
                </Card>
            )),
        },
        {
            title: 'Bordered',
            Demo: component(() => () => (
                <Card bordered>
                    <Card.Body>
                        <Text weight="semibold">Bordered card</Text>
                        <Text size="sm">Outline instead of the filled surface.</Text>
                    </Card.Body>
                </Card>
            )),
        },
        {
            title: 'With actions',
            Demo: component(() => () => (
                <Card>
                    <Card.Body>
                        <Text weight="semibold">Composable body</Text>
                        <Text size="sm">Anything goes inside Card.Body — rows, buttons, inputs.</Text>
                        <Col gap={8}>
                            <Row gap={8}>
                                <Button color="primary" size="sm">Accept</Button>
                                <Button color="error" size="sm" variant="flat">Decline</Button>
                            </Row>
                        </Col>
                    </Card.Body>
                </Card>
            )),
        },
    ],
};
