import { component } from '@sigx/lynx';
import { Badge, Col, Row, Text } from '@sigx/lynx-daisyui';
import type { DaisyComponentDemo } from '../registry.js';

/**
 * Badge — colour variants, the size ramp and the outline modifier.
 *
 * Badge is a presentational inline label with no interactive state, so all
 * sections are static.
 */
export const badgeDemo: DaisyComponentDemo = {
    id: 'badge',
    title: 'Badge',
    description: 'Colour variants, size ramp and outline modifier',
    icon: { set: 'lucide', name: 'badge-check' },
    sections: [
        {
            title: 'Variants',
            Demo: component(() => () => (
                <Row gap={8} class="flex-wrap">
                    <Badge color="primary">Primary</Badge>
                    <Badge color="secondary">Secondary</Badge>
                    <Badge color="accent">Accent</Badge>
                    <Badge color="neutral">Neutral</Badge>
                    <Badge color="info">Info</Badge>
                    <Badge color="success">Success</Badge>
                    <Badge color="warning">Warning</Badge>
                    <Badge color="error">Error</Badge>
                    <Badge variant="ghost">Ghost</Badge>
                </Row>
            )),
        },
        {
            title: 'Sizes',
            Demo: component(() => () => (
                <Row gap={8} align="center" class="flex-wrap">
                    <Badge color="primary" size="xs">xs</Badge>
                    <Badge color="primary" size="sm">sm</Badge>
                    <Badge color="primary" size="md">md</Badge>
                    <Badge color="primary" size="lg">lg</Badge>
                </Row>
            )),
        },
        {
            title: 'Outline',
            note: 'outline modifier across a few variants',
            Demo: component(() => () => (
                <Row gap={8} class="flex-wrap">
                    <Badge color="primary" variant="outline">Primary</Badge>
                    <Badge color="success" variant="outline">Success</Badge>
                    <Badge color="warning" variant="outline">Warning</Badge>
                    <Badge color="error" variant="outline">Error</Badge>
                </Row>
            )),
        },
        {
            title: 'Inline with text',
            note: 'badges sit alongside running copy',
            Demo: component(() => () => (
                <Col gap={8}>
                    <Row gap={6} align="center">
                        <Text>Inbox</Text>
                        <Badge color="primary" size="sm">12</Badge>
                    </Row>
                    <Row gap={6} align="center">
                        <Text>Status</Text>
                        <Badge color="success" size="sm">Active</Badge>
                    </Row>
                </Col>
            )),
        },
    ],
};
