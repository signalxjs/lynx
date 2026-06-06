import { component } from '@sigx/lynx';
import { Button, Card, Col, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Card — the `Card` compound and its `Body` / `Title` / `Actions` parts,
 * plus the `bordered` / `compact` / `shadow` modifiers.
 *
 * `Card` is a `compound`, so structured content goes through the dotted
 * sub-components (`Card.Body`, `Card.Title`, `Card.Actions`); `shadow`
 * defaults to `shadow-md` when omitted.
 */
export const cardDemo: DaisyComponentDemo = {
    id: 'card',
    title: 'Card',
    description: 'Body / Title / Actions parts, bordered, compact & shadow modifiers',
    icon: { set: 'lucide', name: 'square' },
    sections: [
        {
            title: 'Basic',
            note: 'Title + body copy + an action row',
            Demo: component(() => () => (
                <Card class="w-72">
                    <Card.Body>
                        <Card.Title>Card title</Card.Title>
                        <Text class="opacity-70">
                            A card groups related content with a consistent
                            surface, padding and shadow.
                        </Text>
                        <Card.Actions class="justify-end">
                            <Button color="primary" size="sm">Action</Button>
                        </Card.Actions>
                    </Card.Body>
                </Card>
            )),
        },
        {
            title: 'Bordered',
            note: 'A 1px outline instead of (or with) the shadow',
            Demo: component(() => () => (
                <Card bordered class="w-72">
                    <Card.Body>
                        <Card.Title>Bordered</Card.Title>
                        <Text class="opacity-70">Outlined with `card-bordered`.</Text>
                    </Card.Body>
                </Card>
            )),
        },
        {
            title: 'Compact',
            note: 'Tighter `card-compact` body padding',
            Demo: component(() => () => (
                <Card compact bordered class="w-72">
                    <Card.Body>
                        <Card.Title>Compact</Card.Title>
                        <Text class="opacity-70">Less internal padding for dense lists.</Text>
                    </Card.Body>
                </Card>
            )),
        },
        {
            title: 'Shadow ramp',
            note: 'shadow="sm" / "md" / "lg"',
            Demo: component(() => () => (
                <Col gap={16}>
                    <Card shadow="sm" class="w-72">
                        <Card.Body><Card.Title>shadow sm</Card.Title></Card.Body>
                    </Card>
                    <Card shadow="md" class="w-72">
                        <Card.Body><Card.Title>shadow md</Card.Title></Card.Body>
                    </Card>
                    <Card shadow="lg" class="w-72">
                        <Card.Body><Card.Title>shadow lg</Card.Title></Card.Body>
                    </Card>
                </Col>
            )),
        },
    ],
};
